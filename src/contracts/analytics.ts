export type AnalyticsRange = '7d' | '30d' | '90d';

export interface CustomerAnalyticsDto {
  requesterId: string;
  range: string;
  profile: {
    name: string;
    isVerified: boolean;
    isAadhaarVerified: boolean;
    isPANVerified: boolean;
    isBankVerified: boolean;
  };
  metrics: {
    postedTasks: number;
    totalBids: number;
    genuineTaskCount: number;
    categories: Array<{
      category: string;
      count: number;
    }>;
  };
  generatedAt: string;
}

export interface CustomerVerificationComparisonDto {
  range: string;
  verified: {
    CustomerCount: number;
    taskCount: number;
    bidCount: number;
    avgTasksPerCustomer: number;
    avgBidsPerTask: number;
  };
  unverified: {
    CustomerCount: number;
    taskCount: number;
    bidCount: number;
    avgTasksPerCustomer: number;
    avgBidsPerTask: number;
  };
  generatedAt: string;
}

export interface TaskCategoryBreakdownDto {
  range: string;
  categories: Array<{
    category: string;
    count: number;
    subcategories: Array<{
      subcategory: string;
      count: number;
    }>;
  }>;
  generatedAt: string;
}

export interface TaskCategoryPerformanceDto {
  range: string;
  totals: {
    posted: number;
    open: number;
    active: number;
    completed: number;
    cancelled: number;
    completionRate: number;
    cancellationRate: number;
  };
  categories: Array<{
    category: string;
    posted: number;
    open: number;
    active: number;
    completed: number;
    cancelled: number;
    completionRate: number;
    cancellationRate: number;
    fulfillmentRate: number;
  }>;
  generatedAt: string;
}

export interface TaskCancellationAnalyticsDto {
  range: string;
  totals: {
    totalTasks: number;
    cancelledTasks: number;
    cancellationRate: number;
    cancelledBeforeAssignment: number;
    cancelledAfterAssignment: number;
  };
  trend: Array<{
    date: string;
    totalTasks: number;
    cancelledTasks: number;
    cancellationRate: number;
  }>;
  categories: Array<{
    category: string;
    totalTasks: number;
    cancelledTasks: number;
    cancellationRate: number;
  }>;
  generatedAt: string;
}

export interface UserAnalyticsDto {
  userId: string;
  range: string;
  profile: {
    profileId: string;
    uid: string;
    name: string;
    email?: string;
    role: 'Helper' | 'Customer' | 'unknown';
    roles: Array<'Helper' | 'Customer'>;
    isVerified: boolean;
    isAadhaarVerified: boolean;
    isPANVerified: boolean;
    isBankVerified: boolean;
  };
  Customer: {
    postedTasks: number;
    totalBidsReceived: number;
    tasksWithAtLeastOneBid: number;
    openTasks: number;
    activeTasks: number;
    completedTasks: number;
    questionsAskedOnMyTasks: number;
  };
  Helper: {
    applicationsPlaced: number;
    acceptedApplications: number;
    pendingApplications: number;
    activeAssignedTasks: number;
    completedAssignedTasks: number;
    questionsAsked: number;
    answersGiven: number;
  };
  generatedAt: string;
}

