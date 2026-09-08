import { isLocalMode } from "@/lib/config";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Shield } from "lucide-react";
import { LocalEnvManager } from "@/components/env-manager/local-env-manager";

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export default function LocalEnvManagerPage() {

  return <LocalEnvManager />
}
