import { createTheme, MantineColorsTuple } from "@mantine/core";

// Tokens taken from the GwenOS marketing site's stylesheet (pink #fe017d, deep teal #05526d, cream #f9f7f2).
const gwen: MantineColorsTuple = ["#fff0f7", "#ffd9ec", "#ffb3d9", "#ff80bf", "#ff4da6", "#ff1a8d", "#fe017d", "#d6016a", "#a80154", "#7a013d"];
const deep: MantineColorsTuple = ["#e6f2f5", "#c1dddf", "#9ccbd0", "#76b3b8", "#4f98a2", "#2d7a8a", "#05526d", "#044259", "#033245", "#022331"];

export const theme = createTheme({
  primaryColor: "gwen",
  primaryShade: 6,
  colors: { gwen, deep },
  fontFamily: "var(--font-public-sans), sans-serif",
  headings: { fontFamily: "var(--font-outfit), sans-serif", fontWeight: "600" },
  defaultRadius: "md",
  black: "#1a1a1a",
  components: {
    Card: { defaultProps: { withBorder: true, radius: "lg", shadow: "xs" } },
    Button: { styles: { root: { fontFamily: "var(--font-outfit), sans-serif", fontWeight: 600 } } },
    Tabs: { styles: { tabLabel: { fontFamily: "var(--font-outfit), sans-serif", fontWeight: 500, fontSize: 15 } } },
  },
});
