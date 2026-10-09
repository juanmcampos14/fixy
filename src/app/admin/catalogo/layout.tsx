import { SectionGuard } from "@/components/admin/section-guard";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <SectionGuard section="catalogo">{children}</SectionGuard>;
}
