import { z } from "zod";

export const MineralLimitSchema =
z.object({

    min:
        z.number(),

    max:
        z.number(),

    tolerance:
        z.number()
        .min(0),

});

export const AnimalMineralLimitSchema =
z.object({

    calcium:
        MineralLimitSchema,

    phosphorus:
        MineralLimitSchema,

});