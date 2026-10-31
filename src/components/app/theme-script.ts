export const THEME_KEY = "roomie-theme"

/**
 * The public site (landing, /help, /privacy, sign-in, Claim and Join links) is dark in every browser; only the
 * dashboard and the design page follow the light / dark / system preference.
 */
export const THEMED_PATHS = /^\/(g|design)(\/|$)/

// Runs before first paint (inlined in the layout) so the page never flashes the wrong theme.
export const themeScript = `(function(){try{var p=localStorage.getItem("${THEME_KEY}")||"system";var d=!${THEMED_PATHS}.test(location.pathname)||p==="dark"||(p==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.classList.toggle("dark",d);r.style.colorScheme=d?"dark":"light"}catch(e){}})()`
