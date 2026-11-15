// Same Light/Dark choice as the main app (kept in localStorage "cs-theme").
try { var t = localStorage.getItem("cs-theme"); if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t); } catch (e) {}
