import { z } from "zod";

const IntakeSchema = z.union([

    z.number().positive(),

    z.object({

        min: z.number(),

        max: z.number(),

    }).superRefine((v,ctx)=>{

        if(v.min>v.max){

            ctx.addIssue({

                code:"custom",

                message:
                "Intake minimum cannot exceed maximum."

            });

        }

    })

]);

export const AnimalRequirementSchema =
z.object({

    totalIntakeKg:
        IntakeSchema,

    reqCP_kg:
        z.number().positive(),

    reqDE_mcal:
        z.number().positive(),

    reqCa_g:
        z.number().positive(),

    reqP_g:
        z.number().positive(),

});




// import { z } from "zod";

export const UserFeedSchema =
z.object({

    name:
        z.string().min(1),

    ratio:
        z.number()
        .positive()
        .optional(),

    minKg:
        z.number()
        .min(0)
        .optional(),

    maxKg:
        z.number()
        .positive()
        .optional(),

}).superRefine((v,ctx)=>{

    if(
        v.minKg!=null &&
        v.maxKg!=null &&
        v.minKg>v.maxKg
    ){

        ctx.addIssue({

            code:"custom",

            message:
            "minKg cannot exceed maxKg."

        });

    }

});