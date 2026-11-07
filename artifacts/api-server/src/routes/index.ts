import { Router, type IRouter } from "express";
import healthRouter from "./health";
import storeRouter from "./store";
import mediaRouter from "./media";

const router: IRouter = Router();

router.use(healthRouter);
router.use(storeRouter);
router.use(mediaRouter);

export default router;
