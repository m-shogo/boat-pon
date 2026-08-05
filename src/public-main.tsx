import React from "react";
import ReactDOM from "react-dom/client";
import { PublicDashboardApp } from "./components/PublicDashboardApp";
import "./public-portal.css";

const root = document.getElementById("public-root");
if (!root) throw new Error("public-root is missing");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <PublicDashboardApp />
  </React.StrictMode>,
);
