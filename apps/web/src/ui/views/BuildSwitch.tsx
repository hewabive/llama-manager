import { Switch, Tooltip } from "@mantine/core";

export function BuildSwitch(props: {
  label: string;
  tooltip: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <Tooltip label={props.tooltip} withArrow>
      <Switch
        label={props.label}
        checked={props.checked}
        disabled={props.disabled ?? false}
        onChange={(event) => props.onChange(event.currentTarget.checked)}
      />
    </Tooltip>
  );
}
