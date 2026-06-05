import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import {
  getLlamaArguments,
  getPresetsSettings,
  listPathCatalog,
} from "../../../api/client";
import {
  buildPresetArgOptionMap,
  isSelectablePresetArgument,
} from "../../components/PresetArguments";

function usePresetValidationBinaryPath(): string | undefined {
  const presetsSettingsQuery = useQuery({
    queryKey: ["presets-settings"],
    queryFn: getPresetsSettings,
    staleTime: 60_000,
  });
  const pathCatalogQuery = useQuery({
    queryKey: ["path-catalog"],
    queryFn: () => listPathCatalog(),
    staleTime: 60_000,
  });
  const refId =
    presetsSettingsQuery.data?.data.validationBinaryPathRefId ?? null;
  if (!refId) {
    return undefined;
  }
  return pathCatalogQuery.data?.data.find(
    (entry) => entry.id === refId && entry.kind === "binary",
  )?.path;
}

export function useArgsCatalog() {
  const queryClient = useQueryClient();
  const binaryPath = usePresetValidationBinaryPath();
  const argsKey = ["llama-args", "preset", binaryPath ?? "default"];
  const argsCatalogQuery = useQuery({
    queryKey: argsKey,
    queryFn: () => getLlamaArguments(binaryPath),
    staleTime: 60_000,
    retry: false,
  });
  const knownArgs = useMemo(
    () => argsCatalogQuery.data?.data.options ?? [],
    [argsCatalogQuery.data],
  );
  const refreshArgsMutation = useMutation({
    mutationFn: () => getLlamaArguments(binaryPath, true),
    onSuccess: (result) => {
      queryClient.setQueryData(argsKey, result);
      notifications.show({
        title: "Argument catalog refreshed",
        message: `${result.data.options.length} options`,
      });
    },
    onError: (error) => {
      notifications.show({
        color: "red",
        title: "Argument refresh failed",
        message: (error as Error).message,
      });
    },
  });
  return {
    knownArgs,
    knownArgByPresetKey: buildPresetArgOptionMap(knownArgs),
    selectablePresetArgs: knownArgs.filter(isSelectablePresetArgument),
    isError: argsCatalogQuery.isError,
    isFetching: argsCatalogQuery.isFetching,
    refresh: () => refreshArgsMutation.mutate(),
    refreshing: refreshArgsMutation.isPending,
  };
}
