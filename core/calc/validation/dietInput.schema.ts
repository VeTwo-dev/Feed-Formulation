import { z } from "zod";

import { AnimalRequirementSchema, UserFeedSchema } from "./animal.schema";
import { FeedDatabaseSchema } from "./feed.schema";



export const DietInputSchema =
z.object({

    species:
        z.string().min(1),

    feedDatabase:
        FeedDatabaseSchema,

    roughages:
        z.array(UserFeedSchema),

    concentrates:
        z.array(UserFeedSchema),

    minerals:
        z.array(UserFeedSchema)
        .optional(),

    forageFractionOverride:
        z.number()
        .min(0)
        .max(1)
        .optional(),

    cpTolerancePct:
        z.number()
        .min(0)
        .max(100)
        .optional(),

    roughageConcentrateRatio:
        z.object({

            roughage:
                z.number().positive(),

            concentrate:
                z.number().positive(),

        }).optional(),

    animal:
        AnimalRequirementSchema,

}).superRefine((v,ctx)=>{

    if(
        v.roughages.length===0 &&
        v.concentrates.length===0
    ){

        ctx.addIssue({

            code:"custom",

            message:
            "At least one feed must be supplied."

        });

    }

});