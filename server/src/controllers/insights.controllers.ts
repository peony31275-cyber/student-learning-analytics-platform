import type { Request, Response } from 'express';
import { z } from 'zod';
import { currentUser } from '../middleware/authorize.js';
import * as analytics from '../services/analytics.service.js';
import * as risk from '../services/risk.service.js';
import { ok, paginated } from '../utils/http.js';
import { idParam, uuid } from '../validators/common.js';
import { listAlertsQuery, recalculateSchema, updateAlertSchema } from '../validators/resource.validators.js';

const analyticsQuery = z.object({
  courseId: uuid.optional(),
  term: z.string().trim().max(20).optional(),
});
const id = (req: Request) => idParam.parse(req.params).id;

export const analyticsController = {
  overview: async (req: Request, res: Response) => {
    ok(res, await analytics.overview(currentUser(req), analyticsQuery.parse(req.query)));
  },
  scoreTrends: async (req: Request, res: Response) => {
    ok(res, await analytics.scoreTrends(currentUser(req), analyticsQuery.parse(req.query)));
  },
  courseComparison: async (req: Request, res: Response) => {
    ok(res, await analytics.courseComparison(currentUser(req), analyticsQuery.parse(req.query)));
  },
  attendance: async (req: Request, res: Response) => {
    ok(res, await analytics.attendanceAnalytics(currentUser(req), analyticsQuery.parse(req.query)));
  },
  riskDistribution: async (req: Request, res: Response) => {
    ok(res, await analytics.riskDistribution(currentUser(req), analyticsQuery.parse(req.query)));
  },
  studentProgress: async (req: Request, res: Response) => {
    ok(res, await analytics.studentProgress(currentUser(req), id(req)));
  },
};

export const riskController = {
  list: async (req: Request, res: Response) => {
    paginated(res, await risk.listAlerts(currentUser(req), listAlertsQuery.parse(req.query)));
  },
  get: async (req: Request, res: Response) => {
    ok(res, await risk.getAlert(currentUser(req), id(req)));
  },
  update: async (req: Request, res: Response) => {
    ok(res, await risk.updateAlert(currentUser(req), id(req), updateAlertSchema.parse(req.body)));
  },
  recalculate: async (req: Request, res: Response) => {
    const { courseId } = recalculateSchema.parse(req.body ?? {});
    ok(res, await risk.recalculate(currentUser(req), courseId));
  },
  forStudent: async (req: Request, res: Response) => {
    ok(res, await risk.getStudentRisk(currentUser(req), id(req)));
  },
  getConfig: async (req: Request, res: Response) => {
    ok(res, await risk.getRiskConfig(currentUser(req).schoolId));
  },
  updateConfig: async (req: Request, res: Response) => {
    ok(res, await risk.updateRiskConfig(currentUser(req), req.body));
  },
};
