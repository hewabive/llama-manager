import { ActionIcon, Autocomplete, type AutocompleteProps } from "@mantine/core";
import { useMediaQuery, useMergedRef } from "@mantine/hooks";
import { Keyboard } from "lucide-react";
import { forwardRef, useRef, useState } from "react";

export const TouchAutocomplete = forwardRef<HTMLInputElement, AutocompleteProps>(
  function TouchAutocomplete(props, ref) {
    const coarsePointer = useMediaQuery("(pointer: coarse)", false, {
      getInitialValueInEffect: false,
    });
    const innerRef = useRef<HTMLInputElement>(null);
    const mergedRef = useMergedRef(ref, innerRef);
    const [typing, setTyping] = useState(false);

    if (!coarsePointer) {
      return <Autocomplete ref={ref} {...props} />;
    }

    const enableTyping = () => {
      setTyping(true);
      requestAnimationFrame(() => innerRef.current?.focus());
    };

    const toggle = props.leftSection ? null : (
      <ActionIcon
        aria-label="Type manually"
        color="gray"
        size="sm"
        variant="subtle"
        onMouseDown={(event) => event.preventDefault()}
        onClick={enableTyping}
      >
        <Keyboard size={16} />
      </ActionIcon>
    );

    return (
      <Autocomplete
        {...props}
        {...(toggle
          ? { leftSection: toggle, leftSectionPointerEvents: "all" as const }
          : {})}
        ref={mergedRef}
        inputMode={typing ? "text" : "none"}
        onOptionSubmit={(value) => {
          setTyping(false);
          props.onOptionSubmit?.(value);
        }}
        onBlur={(event) => {
          setTyping(false);
          props.onBlur?.(event);
        }}
      />
    );
  },
);
