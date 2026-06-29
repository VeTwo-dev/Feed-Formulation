// استدعاء الدالة الأساسية التي نريد اختبارها من ملف خارجي وإعطائها اسم مستعار (targetFunction)
import { calculateSingelSource as targetFunction } from './calc/horse';

// تعريف نوع بيانات يمثل صفاً واحداً في الجدول. 
// عبارة عن كائن (Object) مفاتيحه نصوص وقيمه يمكن أن تكون أي شيء (any).
type TableRow = Record<string, any>;

// دالة مساعدة لتحويل المدخلات النصية القادمة من سطر الأوامر إلى أنواع البيانات الصحيحة
function parseArgs(args: string[]): any[] {
  // المرور على كل مدخل وتعديله بناءً على محتواه
  return args.map(arg => {
    // إذا كان النص "true"، حوله إلى القيمة المنطقية true
    if (arg.toLowerCase() === 'true') return true;
    
    // إذا كان النص "false"، حوله إلى القيمة المنطقية false
    if (arg.toLowerCase() === 'false') return false;
    
    // إذا كان النص عبارة عن رقم (وليس فارغاً)، حوله من نص إلى رقم حقيقي
    if (!isNaN(Number(arg)) && arg.trim() !== '') return Number(arg); 
    
    // إذا لم يكن أياً مما سبق، اتركه كنص كما هو
    return arg; 
  });
}

// دالة وظيفتها رسم جدول نصي ديناميكي وعرض البيانات بداخله في سطر الأوامر (Terminal)
function printDynamicTable(data: TableRow[]): void {
  // التحقق مما إذا كانت هناك بيانات لعرضها من الأساس
  if (!data || data.length === 0) {
    console.log("No data available to display.");
    return;
  }
  
  // استخراج أسماء جميع الأعمدة من البيانات (عن طريق جمع كل المفاتيح بدون تكرار)
  const columns = Array.from(new Set(data.flatMap(Object.keys)));
  
  // كائن لتخزين العرض المناسب لكل عمود (عدد الحروف)
  const colWidths: Record<string, number> = {};

  // كخطوة أولى: تعيين عرض كل عمود بناءً على طول اسم العمود نفسه
  columns.forEach((col) => {
    colWidths[col] = col.toString().length;
  });

  // المرور على كل صف لتحديث عرض الأعمدة إذا كانت هناك قيمة أطول من اسم العمود
  data.forEach((row) => {
    columns.forEach((col) => {
      // تحويل القيمة لنص للتمكن من حساب عدد حروفها (أو تركها فارغة إذا لم تكن موجودة)
      const cellValue = String(row[col] ?? "");
      // إذا كان طول القيمة أكبر من العرض المحفوظ للعمود، قم بتحديث العرض
      if (cellValue.length > colWidths[col]) {
        colWidths[col] = cellValue.length;
      }
    });
  });

  // إنشاء السطر الفاصل الخاص بحدود الجدول (مثل: +----+-------+)
  const border = "+" + columns.map((col) => "-".repeat(colWidths[col] + 2)).join("+") + "+";

  // طباعة الحد العلوي للجدول
  console.log(border);
  
  // تنسيق أسماء الأعمدة (رأس الجدول) مع ترك مسافات لتناسب عرض كل عمود وطباعتها
  const headerStr = columns.map((col) => ` ${col.toString().padEnd(colWidths[col])} `).join("|");
  console.log(`|${headerStr}|`);
  
  // طباعة الحد الفاصل بين رأس الجدول والبيانات
  console.log(border);

  // المرور على كل صف في البيانات لطباعته
  data.forEach((row) => {
    const rowStr = columns.map((col) => {
      // إحضار القيمة وتنسيقها بإضافة مسافات لتتساوى مع عرض العمود
      const cellValue = String(row[col] ?? "");
      return ` ${cellValue.padEnd(colWidths[col])} `;
    }).join("|");
    // طباعة الصف محاطاً بالخطوط العمودية
    console.log(`|${rowStr}|`);
  });

  // طباعة الحد السفلي لإغلاق الجدول
  console.log(border);
}

// الدالة الرئيسية التي تدير عملية التنفيذ بأكملها
export function executeAndDisplayTable(): void {
  // التقاط المدخلات التي كتبها المستخدم في سطر الأوامر (يتم تجاهل أول عنصرين لأنهما يمثلان مسار node ومسار الملف)
  const terminalArgs: string[] = process.argv.slice(2);

  // تمرير المدخلات إلى دالة parseArgs لتحويلها إلى أرقام أو قيم منطقية بدلاً من نصوص فقط
  const parsedArgs = parseArgs(terminalArgs);

  // تشغيل الدالة المستهدفة (targetFunction) وتمرير المدخلات المعالجة إليها
  const result = targetFunction(...(parsedArgs as unknown as Parameters<typeof targetFunction>));

  // التأكد من أن النتيجة قابلة للعرض في جدول (إذا كانت مصفوفة نأخذها مباشرة، وإلا نبحث عن خاصية rows)
  const rowsToPrint: TableRow[] = Array.isArray(result) ? result : (result?.rows || []);
  
  // استدعاء دالة الرسم لطباعة البيانات النهائية في الجدول
  printDynamicTable(rowsToPrint);
}

// استدعاء الدالة الرئيسية لبدء تشغيل السكريبت فعلياً
executeAndDisplayTable();