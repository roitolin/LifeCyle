type ReportLike = {
  reporterId?: string;
  targetUserId?: string;
  status?: string;
};

type BlockLike = {
  blockerId?: string;
  blockedId?: string;
  active?: boolean;
};

type ServiceRequestLike = {
  requesterId?: string;
  status?: string;
  deceasedFullName?: string;
  familyCoordinatorName?: string;
};

type UserLike = {
  id: string;
  disabled?: boolean;
};

export type RiskProfile = {
  userId: string;
  score: number;
  level: "low" | "medium" | "high";
  openReports: number;
  activeBlocksAsTarget: number;
  activeBlocksAsBlocker: number;
  suspiciousRequests: number;
  reasons: string[];
};

export function buildRiskProfiles({
  reports,
  blocks,
  serviceRequests = [],
  users,
}: {
  reports: ReportLike[];
  blocks: BlockLike[];
  serviceRequests?: ServiceRequestLike[];
  users: UserLike[];
}): RiskProfile[] {
  const profiles = new Map<string, RiskProfile>();

  const ensureProfile = (userId: string) => {
    const normalized = String(userId || "").trim();
    if (!normalized) return null;
    if (!profiles.has(normalized)) {
      profiles.set(normalized, {
        userId: normalized,
        score: 0,
        level: "low",
        openReports: 0,
        activeBlocksAsTarget: 0,
        activeBlocksAsBlocker: 0,
        suspiciousRequests: 0,
        reasons: [],
      });
    }
    return profiles.get(normalized) || null;
  };

  users.forEach((user) => {
    const profile = ensureProfile(user.id);
    if (profile && user.disabled) {
      profile.score += 2;
      profile.reasons.push("Account disabled");
    }
  });

  reports.forEach((report) => {
    const status = String(report.status || "open").toLowerCase();
    if (status !== "open" && status !== "reviewing") return;
    const profile = ensureProfile(report.targetUserId || "");
    if (!profile) return;
    profile.openReports += 1;
    profile.score += status === "open" ? 3 : 2;
    profile.reasons.push(`Moderation report ${status}`);
  });

  blocks.forEach((block) => {
    if (block.active === false) return;
    const targetProfile = ensureProfile(block.blockedId || "");
    if (targetProfile) {
      targetProfile.activeBlocksAsTarget += 1;
      targetProfile.score += 2;
      targetProfile.reasons.push("Blocked by another user");
    }
    const blockerProfile = ensureProfile(block.blockerId || "");
    if (blockerProfile) {
      blockerProfile.activeBlocksAsBlocker += 1;
      blockerProfile.score += 1;
    }
  });

  serviceRequests.forEach((request) => {
    const profile = ensureProfile(request.requesterId || "");
    if (!profile) return;
    const missingRequiredName = !String(request.deceasedFullName || "").trim() || !String(request.familyCoordinatorName || "").trim();
    if (missingRequiredName) {
      profile.suspiciousRequests += 1;
      profile.score += 1;
      profile.reasons.push("Incomplete service request details");
    }
  });

  return Array.from(profiles.values())
    .map((profile): RiskProfile => {
      const level: RiskProfile["level"] = profile.score >= 7 ? "high" : profile.score >= 3 ? "medium" : "low";
      return {
        ...profile,
        level,
        reasons: Array.from(new Set(profile.reasons)),
      };
    })
    .filter((profile) => profile.score > 0)
    .sort((a: any, b: any) => b.score - a.score);
}
