import { useQuery } from "@tanstack/react-query";

import { getSystemResources } from "../../api/client";
import { SystemResourcesPanel } from "../components/SystemResourcesPanel";

export function SystemResourcesView() {
  const resourcesQuery = useQuery({
    queryKey: ["system-resources"],
    queryFn: getSystemResources,
    refetchInterval: 5_000,
  });

  return (
    <SystemResourcesPanel
      resources={resourcesQuery.data?.data}
      fetching={resourcesQuery.isFetching}
    />
  );
}
