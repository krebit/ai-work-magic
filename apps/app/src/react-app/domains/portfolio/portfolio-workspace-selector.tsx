/** @jsxImportSource react */

export type PortfolioWorkspaceOption = {
  id: string;
  name: string;
};

export function PortfolioWorkspaceSelector({
  selectedWorkspaceId,
  workspaces,
  onSelectWorkspace,
}: {
  selectedWorkspaceId: string;
  workspaces: PortfolioWorkspaceOption[];
  onSelectWorkspace: (workspaceId: string) => void;
}) {
  return (
    <label className="grid min-w-52 gap-1 text-xs font-medium text-muted-foreground">
      Portfolio workspace
      <select
        aria-label="Portfolio workspace"
        className="h-9 rounded-md border bg-background px-3 text-sm font-medium text-foreground"
        value={selectedWorkspaceId}
        onChange={(event) => onSelectWorkspace(event.target.value)}
      >
        {workspaces.map((workspace) => (
          <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
        ))}
      </select>
    </label>
  );
}
