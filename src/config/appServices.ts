export type AppService = "funeral";

export const appServices: Record<
  AppService,
  {
    key: AppService;
    label: string;
    shortLabel: string;
    description: string;
    accent: string;
    softAccent: string;
    border: string;
    icon: string;
  }
> = {
  funeral: {
    key: "funeral",
    label: "LifeCycle",
    shortLabel: "Funeral Shop",
    description: "Funeral service support for viewing providers, planning arrangements, and staying updated.",
    accent: "#334155",
    softAccent: "#f8fafc",
    border: "#cbd5e1",
    icon: "ribbon",
  },
};
