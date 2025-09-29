<<<<<<< HEAD
=======
// src/main.jsx
>>>>>>> aa58d1e669c1eee08387c46296b920f19d243875
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

<<<<<<< HEAD
// Register service worker for PWA
=======
// SW registration for PWA
>>>>>>> aa58d1e669c1eee08387c46296b920f19d243875
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .catch(console.warn);
  });
}
