/**
 * Payroll arithmetic (prospetto gestionale).
 *
 * It applies the percentages the person enters (they come from the labour consultant) to the
 * gross pay. It does NOT know contribution brackets, IRPEF scales, deductions, regional or
 * municipal surcharges, TFR or any collective agreement: the official pay slip is issued by the
 * labour consultant. Use these figures for cash planning and cost accounting.
 */

export interface PayslipInput {
  basePay: number;
  overtimePay?: number;
  otherPay?: number;
  /** Non-taxable reimbursements (e.g. expenses): added to the net, no contributions or tax. */
  reimbursements?: number;
  employeePct?: number;
  employerPct?: number;
  taxPct?: number;
}

export interface PayslipFigures {
  gross: number;
  contrib_employee: number;
  contrib_employer: number;
  income_tax: number;
  net: number;
  total_cost: number;
}

const pct = (amount: number, rate: number | undefined) => Math.round((amount * (rate ?? 0)) / 100);

/** Amounts are integer cents. Contributions apply to the gross; the tax to gross minus the employee's contributions. */
export function computePayslip(input: PayslipInput): PayslipFigures {
  const gross = input.basePay + (input.overtimePay ?? 0) + (input.otherPay ?? 0);
  const reimbursements = input.reimbursements ?? 0;
  const contribEmployee = pct(gross, input.employeePct);
  const contribEmployer = pct(gross, input.employerPct);
  const incomeTax = pct(gross - contribEmployee, input.taxPct);
  return {
    gross,
    contrib_employee: contribEmployee,
    contrib_employer: contribEmployer,
    income_tax: incomeTax,
    net: gross - contribEmployee - incomeTax + reimbursements,
    total_cost: gross + contribEmployer + reimbursements,
  };
}
