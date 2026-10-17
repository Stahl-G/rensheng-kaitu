import { useState } from "react";
import { FileServicesContext, type FileServices } from "./DshFiles.js";
import { OverviewPage, type OverviewPageProps } from "./OverviewPage.js";

type Props = Omit<OverviewPageProps, "onAgent" | "onPrompt"> & {
  onAgent: () => Promise<void>;
  onPrompt: (text: string) => Promise<void>;
  fileServices: FileServices;
};

export function SessionPage(props: Props) {
  const [error, setError] = useState<string | null>(null);
  const open = async (text?: string) => {
    setError(null);
    try {
      await (text ? props.onPrompt(text) : props.onAgent());
    } catch (err) {
      setError(`打开开图会话失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };
  return (
    <FileServicesContext.Provider value={props.fileServices}>
      {error && <p role="alert">{error}</p>}
      <OverviewPage {...props} onPrompt={(text) => void open(text)} onAgent={() => void open()} />
    </FileServicesContext.Provider>
  );
}
