import AgentForm from "@/components/AgentForm";
export default function EditAgentPage({ params }: { params: { id: string } }) {
  return <AgentForm agentId={Number(params.id)} />;
}
