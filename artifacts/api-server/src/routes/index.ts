import { Router, type IRouter } from "express";
import healthRouter from "./health";
import franchiseFinderRouter from "./franchiseFinder";

const router: IRouter = Router();

router.use(healthRouter);
router.use(franchiseFinderRouter);

export default router;
