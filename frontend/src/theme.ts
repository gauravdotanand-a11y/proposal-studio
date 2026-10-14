import { createTheme } from "@mui/material/styles";

export const makeTheme = (mode: "light" | "dark") =>
  createTheme({
    palette: {
      mode,
      primary: { main: mode === "light" ? "#1B2A7A" : "#9FB0FF" },
      secondary: { main: "#FF4F1F" },
      background:
        mode === "light"
          ? { default: "#F5F5F7", paper: "#FFFFFF" }
          : { default: "#0E0E10", paper: "#1C1C1E" },
    },
    shape: { borderRadius: 14 },
    typography: {
      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, "Segoe UI", Roboto, sans-serif',
      h6: { fontWeight: 650, letterSpacing: "-0.01em" },
      button: { textTransform: "none", fontWeight: 600 },
    },
    components: {
      MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: { root: { borderRadius: 10 } } },
      MuiPaper: { styleOverrides: { root: { backgroundImage: "none" } } },
      MuiAppBar: {
        styleOverrides: {
          root: {
            backdropFilter: "saturate(180%) blur(20px)",
            backgroundColor: mode === "light" ? "rgba(255,255,255,0.72)" : "rgba(28,28,30,0.72)",
            color: "inherit",
            boxShadow: "none",
            borderBottom: "1px solid rgba(128,128,128,0.2)",
          },
        },
      },
      MuiTextField: { defaultProps: { size: "small", variant: "outlined" } },
    },
  });
