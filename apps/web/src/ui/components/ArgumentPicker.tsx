import { Select } from "@mantine/core";
import { useState } from "react";

export type ArgumentPickerOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export function ArgumentPicker(props: {
  data: ArgumentPickerOption[];
  onPick: (value: string) => void;
  label?: string;
  isError?: boolean;
  isFetching?: boolean;
  errorPlaceholder?: string;
  searchPlaceholder?: string;
  nothingFoundMessage?: string;
}) {
  const [value, setValue] = useState<string | null>(null);
  const [pickerKey, setPickerKey] = useState(0);

  return (
    <Select
      key={pickerKey}
      label={props.label ?? "Add argument"}
      placeholder={
        props.isError
          ? (props.errorPlaceholder ?? "Unable to read --help from binary")
          : (props.searchPlaceholder ?? "Search llama-server args")
      }
      searchable
      clearable
      value={value}
      onChange={(next) => {
        if (!next) {
          setValue(null);
          return;
        }
        props.onPick(next);
        setValue(null);
        setPickerKey((key) => key + 1);
      }}
      data={props.data}
      nothingFoundMessage={
        props.nothingFoundMessage ??
        (props.isFetching ? "Loading..." : "No arguments found")
      }
      disabled={Boolean(props.isError)}
    />
  );
}
