import React from "react";
import { createRoot } from "react-dom/client";
import { CssBaseline, ThemeProvider, useMediaQuery } from "@mui/material";
import App from "./App";
import { makeTheme } from "./theme";

function Root() {
  const dark = useMediaQuery("(prefers-color-scheme: dark)");
  const theme = React.useMemo(() => makeTheme(dark ? "dark" : "light"), [dark]);
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  );
}

createRoot(document.getElementById("root")!).render(<Root />);
