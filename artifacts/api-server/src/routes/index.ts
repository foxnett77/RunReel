import { Router, type IRouter } from "express";
import healthRouter from "./health";
import activitiesRouter from "./activities";
import liveRouter from "./live";

const router: IRouter = Router();

router.use(healthRouter);
router.use(activitiesRouter);
router.use(liveRouter);

export default router;
