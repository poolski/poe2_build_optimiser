import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { findRoot } from "./env";
import "./styles.css";

createRoot(findRoot()).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
