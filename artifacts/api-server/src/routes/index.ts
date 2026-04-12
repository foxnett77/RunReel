import { Router, type IRouter } from "express";
import healthRouter from "./health";
import activitiesRouter from "./activities";
import liveRouter from "./live";
import stravaRouter from "./strava";
import deviceRouter from "./device";

const router: IRouter = Router();

router.use(healthRouter);
router.use(activitiesRouter);
router.use(liveRouter);
router.use(stravaRouter);
router.use(deviceRouter);

export default router;
