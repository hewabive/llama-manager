import { type LlamaArgumentOption } from "@llama-manager/core";

import { createUiId } from "../utils/id";
import {
  type ArgRow,
  canonicalOptionForRow,
  cliNameForArgument,
  defaultValueForArgument,
  valueTypeFromArgument,
} from "./InstanceArgumentRows";

export function setDefaultActiveRows(
  rows: ArgRow[],
  option: LlamaArgumentOption,
  knownArgByName: Map<string, LlamaArgumentOption>,
  active: boolean,
): ArgRow[] {
  const without = rows.filter(
    (row) =>
      canonicalOptionForRow(row, knownArgByName)?.primaryName !==
      option.primaryName,
  );
  if (!active) {
    return without;
  }
  const existing = rows.find(
    (row) =>
      canonicalOptionForRow(row, knownArgByName)?.primaryName ===
      option.primaryName,
  );
  return [
    ...without,
    {
      id: existing?.id ?? createUiId(),
      key: cliNameForArgument(option),
      value: existing?.value || defaultValueForArgument(option),
      valueType: valueTypeFromArgument(option),
    },
  ];
}

export function setDefaultValueRows(
  rows: ArgRow[],
  option: LlamaArgumentOption,
  knownArgByName: Map<string, LlamaArgumentOption>,
  value: string,
): ArgRow[] {
  const next: ArgRow = {
    id: createUiId(),
    key: cliNameForArgument(option),
    value,
    valueType: valueTypeFromArgument(option),
  };
  let replaced = false;
  const mapped = rows.map((row) => {
    if (
      canonicalOptionForRow(row, knownArgByName)?.primaryName ===
      option.primaryName
    ) {
      replaced = true;
      return { ...next, id: row.id };
    }
    return row;
  });
  return replaced ? mapped : [...mapped, next];
}
