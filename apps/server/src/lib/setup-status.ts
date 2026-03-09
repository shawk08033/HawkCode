const SETUP_KEY = "setupComplete";

export async function getSetupComplete(): Promise<boolean> {
  const { loadRuntimeConfig } = await import("./runtime-config");
  const config = loadRuntimeConfig();
  if (!config?.databaseUrl) {
    return false;
  }
  try {
    const { prisma } = await import("./prisma");
    const setting = await prisma.systemSetting.findUnique({
      where: { key: SETUP_KEY }
    });
    return setting?.value === "true";
  } catch {
    return false;
  }
}

export async function setSetupComplete(value: boolean): Promise<void> {
  const { prisma } = await import("./prisma");
  await prisma.systemSetting.upsert({
    where: { key: SETUP_KEY },
    update: { value: value ? "true" : "false" },
    create: { key: SETUP_KEY, value: value ? "true" : "false" }
  });
}
