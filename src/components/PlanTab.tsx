"use client";

import { useMemo, useState } from "react";
import { Alert, Badge, Box, Button, Card, Checkbox, Group, Loader, Select, SimpleGrid, Slider, Stack, Table, Text, Title } from "@mantine/core";
import { IconArrowRight, IconSparkles } from "@tabler/icons-react";
import { DEFAULT_CONFIG, generatePlan, LABELS, type PlanConfig } from "@/lib/plan";

const opts = <K extends keyof typeof LABELS>(k: K) => Object.entries(LABELS[k]).map(([value, label]) => ({ value, label: label as string }));
const PHASE_COLORS = ["#05526d", "#2d7a8a", "#76b3b8", "#fe017d", "#d6016a", "#1a1a1a"];

export function PlanTab({ goToProof }: { goToProof: () => void }) {
  const [cfg, setCfg] = useState<PlanConfig>(DEFAULT_CONFIG);
  const [summary, setSummary] = useState<{ text: string; source: string } | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [done, setDone] = useState<Record<string, boolean>>({});
  const plan = useMemo(() => generatePlan(cfg), [cfg]);
  const set = <K extends keyof PlanConfig>(k: K, v: PlanConfig[K]) => { setCfg({ ...cfg, [k]: v }); setSummary(null); };
  const days = cfg.weeks * 7;

  const draft = async () => {
    setDrafting(true);
    try {
      const res = await fetch("/api/plan", { method: "POST", body: JSON.stringify(cfg) });
      const j = await res.json();
      setSummary({ text: j.summary, source: j.source });
    } finally {
      setDrafting(false);
    }
  };

  return (
    <Stack gap="md">
      <Stack gap={2}>
        <Title order={3}>Day 0 to go-live: a customer onboarding command center</Title>
        <Text c="dimmed" fz="sm" maw={780}>
          Pick a customer profile and get the plan I would run: phases by week, integration checklist, risks, and the KPIs to baseline. The data steps in the next tabs prove the hardest part works.
        </Text>
      </Stack>

      <Card>
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
          <Select label="Customer" data={opts("org")} value={cfg.org} onChange={(v) => v && set("org", v as PlanConfig["org"])} allowDeselect={false} />
          <Select label="First use case" data={opts("useCase")} value={cfg.useCase} onChange={(v) => v && set("useCase", v as PlanConfig["useCase"])} allowDeselect={false} />
          <Select label="Primary data source" data={opts("source")} value={cfg.source} onChange={(v) => v && set("source", v as PlanConfig["source"])} allowDeselect={false} />
          <Select label="Deployment" data={opts("deploy")} value={cfg.deploy} onChange={(v) => v && set("deploy", v as PlanConfig["deploy"])} allowDeselect={false} />
        </SimpleGrid>
        <Box mt="md" maw={460}>
          <Text fz="sm" fw={500} mb={6}>Go-live target: {cfg.weeks} weeks ({days} days){days >= 56 && days <= 63 ? " · the 60-day promise" : ""}</Text>
          <Slider min={6} max={12} step={1} value={cfg.weeks} onChange={(v) => set("weeks", v)} marks={[{ value: 8, label: "≈60d" }]} color="gwen" />
        </Box>
      </Card>

      <Card>
        <Text ff="var(--font-outfit)" fw={600} mb="sm">Timeline</Text>
        <Box style={{ display: "grid", gridTemplateColumns: `210px repeat(${cfg.weeks}, 1fr)`, gap: 4, alignItems: "center" }}>
          <Box />
          {Array.from({ length: cfg.weeks }, (_, i) => <Text key={i} fz="xs" c="dimmed" ta="center">W{i + 1}</Text>)}
          {plan.phases.map((p, i) => (
            <Box key={p.name} style={{ display: "contents" }}>
              <Text fz="sm" fw={500} lh={1.2} style={{ gridColumn: 1, gridRow: i + 2 }}>{p.name}</Text>
              <Box style={{ gridRow: i + 2, gridColumn: `${p.start + 1} / span ${p.weeks}`, background: PHASE_COLORS[i], borderRadius: 6, color: "white", padding: "4px 8px", fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={p.outcome}>
                Day {(p.start - 1) * 7 + 1}–{(p.start - 1 + p.weeks) * 7}
              </Box>
            </Box>
          ))}
        </Box>
        <Text fz="xs" c="dimmed" mt="sm">Hover a bar for the phase outcome. Owner for every phase: the forward deployed engineer plus the customer-side role named below.</Text>
        <Table mt="sm" verticalSpacing="xs" fz="sm">
          <Table.Tbody>{plan.phases.map((p) => (
            <Table.Tr key={p.name}><Table.Td fw={500}>{p.name}</Table.Td><Table.Td c="dimmed">{p.owner}</Table.Td><Table.Td>{p.outcome}</Table.Td></Table.Tr>
          ))}</Table.Tbody>
        </Table>
      </Card>

      <SimpleGrid cols={{ base: 1, lg: 2 }}>
        <Card>
          <Text ff="var(--font-outfit)" fw={600} mb={4}>Integration checklist: {LABELS.source[cfg.source]}</Text>
          <Text fz="xs" c="dimmed" mb="sm">{plan.policyWork}</Text>
          <Stack gap={8}>
            {plan.checklist.map((c) => (
              <Checkbox key={c} label={c} checked={!!done[c]} onChange={(e) => setDone({ ...done, [c]: e.currentTarget.checked })} color="deep" />
            ))}
          </Stack>
          <Group mt="md"><Badge variant="light" color="deep">{Object.values(done).filter(Boolean).length}/{plan.checklist.length} done</Badge></Group>
        </Card>
        <Card>
          <Text ff="var(--font-outfit)" fw={600} mb="sm">Risks and how I would handle them</Text>
          <Stack gap="sm">
            {plan.risks.map((r) => (
              <Box key={r.risk}><Text fz="sm" fw={500}>{r.risk}</Text><Text fz="sm" c="dimmed">{r.mitigation}</Text></Box>
            ))}
          </Stack>
        </Card>
      </SimpleGrid>

      <Card padding={0}>
        <Text ff="var(--font-outfit)" fw={600} p="md" pb={0}>KPIs to baseline in week 1</Text>
        <Table verticalSpacing="sm" fz="sm">
          <Table.Thead><Table.Tr><Table.Th>Metric</Table.Th><Table.Th>Baseline</Table.Th><Table.Th>Target</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>{plan.kpis.map((k) => <Table.Tr key={k.metric}><Table.Td fw={500}>{k.metric}</Table.Td><Table.Td>{k.baseline}</Table.Td><Table.Td>{k.target}</Table.Td></Table.Tr>)}</Table.Tbody>
        </Table>
        <Text fz="xs" c="dimmed" p="md" pt={0}>Published figures are Penguin Ai marketing claims. Treat them as targets to validate against the customer&apos;s own baseline, not promises.</Text>
      </Card>

      <Card>
        <Group justify="space-between" mb="xs">
          <Text ff="var(--font-outfit)" fw={600}>Executive kickoff summary</Text>
          <Button size="xs" variant="light" leftSection={drafting ? <Loader size={12} /> : <IconSparkles size={14} />} disabled={drafting} onClick={draft}>
            {summary ? "Redraft" : "Draft with Gemma"}
          </Button>
        </Group>
        {summary ? (
          <>
            <Text fz="sm" style={{ whiteSpace: "pre-wrap" }}>{summary.text}</Text>
            <Text fz="xs" c="dimmed" mt={6}>Drafted by {summary.source}. Review before sending.</Text>
          </>
        ) : <Text fz="sm" c="dimmed">A short note for the executive sponsor, drafted from the plan above.</Text>}
      </Card>

      <Alert color="deep" variant="light" title="Now prove the hardest part">
        <Group justify="space-between">
          <Text fz="sm" maw={640}>The plan only works if messy data becomes trustworthy decisions. Run it on synthetic payer data: validate, resolve, then decide prior auths with evidence.</Text>
          <Button rightSection={<IconArrowRight size={16} />} onClick={goToProof}>Open the data demo</Button>
        </Group>
      </Alert>
    </Stack>
  );
}
