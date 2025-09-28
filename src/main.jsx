import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
// at the end of your existing main.jsx (or index.jsx)
if ("serviceWorker" in navigator) {
  const swUrl = new URL("sw.js", import.meta.env.BASE_URL);
  navigator.serviceWorker.register(swUrl.href);
}

