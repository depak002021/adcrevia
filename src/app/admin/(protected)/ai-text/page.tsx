import { AiTextForm } from "@/components/admin/ai-text-form"
import { readAiTextStatus } from "@/features/admin/ai-text/service"

export default async function AdminAiTextPage() {
  const aiText = await readAiTextStatus()

  return (
    <main className="studio-page narrow-page">
      <header className="studio-header">
        <div>
          <p className="eyebrow">Language models</p>
          <h1>AI text</h1>
          <p>
            Which models write, run the brief conversation and make the product&rsquo;s judgement
            calls. Changes apply to the next request, with no deploy.
          </p>
        </div>
      </header>
      <AiTextForm initial={aiText} />
    </main>
  )
}
