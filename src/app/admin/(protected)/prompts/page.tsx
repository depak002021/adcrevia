import { PromptWorkbench } from "@/components/admin/prompt-workbench"
import { listPromptKeys } from "@/features/admin/prompts/service"

export default async function AdminPromptsPage() {
  const prompts = await listPromptKeys()

  return (
    <main className="studio-page">
      <header className="studio-header">
        <div>
          <p className="eyebrow">Model instructions</p>
          <h1>Prompts</h1>
          <p>
            Every instruction the product sends a model, editable without a deploy. Saving creates a
            new version rather than replacing the old one, so a change that makes things worse is a
            rollback.
          </p>
        </div>
      </header>

      <PromptWorkbench prompts={prompts} />
    </main>
  )
}
