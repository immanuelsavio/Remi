//! macOS: turn the popover's `NSWindow` into a NON-ACTIVATING `NSPanel`.
//!
//! # Why this exists
//!
//! The popover has to draw over ANOTHER app's fullscreen Space (you are in
//! fullscreen VS Code, you click the menu-bar mark, the popover appears on
//! top of VS Code). Three things are needed together, and the first one is
//! the one that cannot be expressed on a plain `NSWindow` at all:
//!
//! 1. **A non-activating panel.** `NSWindowStyleMask::NonactivatingPanel`
//!    is only honoured by `NSPanel`; AppKit ignores it on an `NSWindow`.
//!    Without it, giving the window key status forces AppKit to ACTIVATE
//!    Remi, and activating an app while the user sits in another app's
//!    fullscreen Space makes macOS switch Spaces away from that app - so
//!    the popover "appears" back on the desktop instead of over the
//!    fullscreen app. That Space switch was the actual bug; every earlier
//!    attempt tuned levels and collection behaviour, which are necessary
//!    but not sufficient, and so never fixed it.
//! 2. **`canJoinAllSpaces | fullScreenAuxiliary`.** Tauri's
//!    `set_visible_on_all_workspaces` sets only `canJoinAllSpaces`, which
//!    moves a window between ordinary Spaces but does not let it render
//!    above a Space that is actually fullscreen. `fullScreenAuxiliary` has
//!    no Tauri-level accessor.
//! 3. **`NSStatusWindowLevel` (25).** Tauri's `alwaysOnTop` only reaches
//!    `NSFloatingWindowLevel` (3), and a fullscreen Space composites above
//!    that. 25 is where real menu-bar extras live.
//!
//! # Why a subclass, and why not `tauri-nspanel`
//!
//! A BORDERLESS panel returns `NO` from `canBecomeKeyWindow`, so it could
//! never take keyboard input - and the popover is full of text fields.
//! Overriding that method is the whole reason every menu-bar-popover
//! implementation (including `tauri-nspanel`'s `RawNSPanel`) defines a
//! subclass. We do the same thing directly: `objc2` is already in the
//! dependency tree, the required surface is one method override plus four
//! setters, and `tauri-nspanel` is only distributed as a git dependency
//! pinned to a branch - an unpublished, version-coupled dependency for
//! something this small.
//!
//! # Why reclassing an existing window is sound
//!
//! `object_setClass` is safe when the new class adds no instance
//! variables, because the object's allocation must still be large enough.
//! `NSPanel` adds no ivars over `NSWindow`, and `RemiPopoverPanel` adds
//! none over `NSPanel` - it is a pure behaviour subclass. This is exactly
//! what `tauri-nspanel` does. tao's own window subclass overrides are
//! replaced, but the only one that matters here (`canBecomeKeyWindow`) is
//! reimplemented below, and the window DELEGATE is a separate object that
//! survives untouched - so Tauri's window events, and with them the
//! click-away autohide, keep working.

use std::ffi::CStr;

use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject, Bool, ClassBuilder, NSObjectProtocol, Sel};
use objc2::{sel, ClassType, Message};
use objc2_app_kit::{
    NSPanel, NSStatusWindowLevel, NSWindow, NSWindowCollectionBehavior, NSWindowStyleMask,
};

/// Runtime name of our `NSPanel` subclass. Must be unique process-wide.
const PANEL_CLASS_NAME: &CStr = c"RemiPopoverPanel";

/// A borderless window - panel or not - answers `NO` here by default, which
/// would leave the popover unable to focus a text field. Answering `YES` is
/// the single behavioural difference between this subclass and `NSPanel`.
extern "C" fn can_become_key_window(_this: &AnyObject, _sel: Sel) -> Bool {
    Bool::YES
}

/// Register (once) and return the `RemiPopoverPanel` class.
///
/// Idempotent by lookup rather than by `Once`: re-registering a name would
/// fail, and this is only ever called from the main thread, so a plain
/// check-then-create is enough.
fn panel_class() -> &'static AnyClass {
    if let Some(existing) = AnyClass::get(PANEL_CLASS_NAME) {
        return existing;
    }
    let mut builder = ClassBuilder::new(PANEL_CLASS_NAME, NSPanel::class())
        .expect("RemiPopoverPanel: class name unexpectedly already registered");
    // SAFETY: the signature matches `-[NSWindow canBecomeKeyWindow]`
    // exactly - no arguments beyond the implicit pair, returning `BOOL`.
    unsafe {
        builder.add_method(
            sel!(canBecomeKeyWindow),
            can_become_key_window as extern "C" fn(_, _) -> _,
        );
    }
    builder.register()
}

/// Borrow a Tauri window's underlying `NSWindow`, or `None` if it has no
/// native window yet.
///
/// # Safety contract
///
/// `ns_window()` hands back a valid, retained `NSWindow*` that lives at
/// least as long as the Tauri window. `objc2` object types are
/// `#[repr(transparent)]` over the pointer, so recovering a typed reference
/// from Tauri's raw escape hatch is the intended cast.
fn ns_window(win: &tauri::WebviewWindow) -> Option<Retained<NSWindow>> {
    let ptr = win.ns_window().ok()?;
    if ptr.is_null() {
        return None;
    }
    let obj: &NSWindow = unsafe { &*(ptr as *const NSWindow) };
    Some(obj.retain())
}

/// Convert the window into a non-activating, status-level, all-Spaces panel.
///
/// Idempotent: safe to call again on every show, which matters because
/// macOS can reset a window's level as the app's activation state changes.
pub fn make_overlay_panel(win: &tauri::WebviewWindow) {
    let Some(window) = ns_window(win) else { return };

    // Reclass first: the style mask below is only honoured by an NSPanel.
    if !window.isKindOfClass(panel_class()) {
        let obj: &AnyObject = &window;
        // SAFETY: `RemiPopoverPanel` adds no instance variables over
        // `NSPanel`, which adds none over `NSWindow`, so the existing
        // allocation remains large enough. See the module docs.
        unsafe { AnyObject::set_class(obj, panel_class()) };
    }

    window.setStyleMask(window.styleMask() | NSWindowStyleMask::NonactivatingPanel);
    window.setLevel(NSStatusWindowLevel);
    window.setCollectionBehavior(
        window.collectionBehavior()
            | NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::FullScreenAuxiliary,
    );
    // An Accessory app never "deactivates" the way a normal app does, and
    // hiding on deactivate would fight the click-away autohide, which owns
    // dismissal.
    window.setHidesOnDeactivate(false);
}

/// Order the panel front and make it key WITHOUT activating the app.
///
/// Deliberately not Tauri's `set_focus()`: tao implements that as
/// `makeKeyAndOrderFront:` followed by `[NSApp
/// activateIgnoringOtherApps:YES]`, and that activation is what drags the
/// user out of another app's fullscreen Space. On a non-activating panel
/// `makeKeyAndOrderFront:` alone gives keyboard focus with no activation.
pub fn key_and_order_front(win: &tauri::WebviewWindow) {
    if let Some(window) = ns_window(win) {
        window.makeKeyAndOrderFront(None);
    }
}
