export const THEME_KEY = "roomie-theme"

// Runs before first paint (inlined in the layout) so the page never flashes the wrong theme.
export const themeScript = `(function(){try{var p=localStorage.getItem("${THEME_KEY}")||"system";var d=p==="dark"||(p==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.classList.toggle("dark",d);r.style.colorScheme=d?"dark":"light"}catch(e){}})()`
