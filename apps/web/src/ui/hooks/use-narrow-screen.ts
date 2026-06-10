import { useMediaQuery } from "@mantine/hooks";

export function useNarrowScreen() {
  return (
    useMediaQuery("(max-width: 48em)", false, {
      getInitialValueInEffect: false,
    }) ?? false
  );
}
