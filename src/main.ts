import "./styles/global.css";
import { mountForWindow } from "./app/window-router";

mountForWindow(document.getElementById("app") as HTMLElement);
