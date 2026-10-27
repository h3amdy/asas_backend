// src/school/manager/subscription/types/subscription-settings.types.ts

/** استجابة GET /settings */
export interface SubscriptionSettingsResponse {
    isActivated: boolean;
    activatedAt: string | null;
    isTrialEnabled: boolean;
    trialDurationDays: number | null;
    subscriptionPrice: string | null;
    contactNumber: string | null;
    studentCount: number;
    activeTrialCount: number;
    activePaidCount: number;
    /** إحصائيات رموز التفعيل للمدرسة (أصفار قبل التفعيل) */
    codeStats: { total: number; used: number; unused: number };
}

/** استجابة POST /activate */
export interface ActivateSubscriptionResponse {
    isActivated: boolean;
    activatedAt: string;
    trialPeriodsCreated: number;
    paymentMethodsCreated: number;
}
