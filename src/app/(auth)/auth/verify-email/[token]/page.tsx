import { redirect } from "next/navigation";

export default async function LegacyEmailVerificationPage({
	params,
}: {
	params: Promise<{ token: string }>;
}) {
	const { token } = await params;
	return redirect(`/verify-email/${token}`);
}

