import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import PermissionTestApp from "./PermissionTestApp.tsx";
import "./index.css";

const root = document.getElementById("permission-test-root");
if (!root) throw new Error("Permission test root is missing.");

createRoot(root).render(
  <StrictMode>
    <PermissionTestApp />
  </StrictMode>,
);
