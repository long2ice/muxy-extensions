import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Editor } from "@/editor/editor";
import "@/styles.css";

const root = document.getElementById("root");
if (root) createRoot(root).render(<StrictMode><Editor /></StrictMode>);
