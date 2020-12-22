import { cloneDeep } from 'lodash';
import { isRuleGroup } from '.';
import { ExportFormat, RuleGroupType, RuleType, ValueProcessor } from '../types';

const mapOperator = (op: string) => {
  switch (op.toLowerCase()) {
    case 'null':
      return 'is null';
    case 'notnull':
      return 'is not null';
    case 'notin':
      return 'not in';
    case 'contains':
    case 'beginswith':
    case 'endswith':
      return 'like';
    case 'doesnotcontain':
    case 'doesnotbeginwith':
    case 'doesnotendwith':
      return 'not like';
    default:
      return op;
  }
};

const removeIdsFromRuleGroup = (ruleGroup: RuleGroupType | RuleType) => {
  const ruleGroupCopy = cloneDeep(ruleGroup);
  delete ruleGroupCopy.id;

  if (isRuleGroup(ruleGroupCopy)) {
    ruleGroupCopy.rules = ruleGroupCopy.rules.map((rule) => removeIdsFromRuleGroup(rule));
  }

  return ruleGroupCopy;
};

/**
 * Formats a query in the requested output format.  The optional
 * `valueProcessor` argument can be used to format the values differently
 * based on a given field, operator, and value.  By default, values are
 * processed assuming the default operators are being used.
 */
const formatQuery = (
  ruleGroup: RuleGroupType,
  format: ExportFormat,
  valueProcessor?: ValueProcessor
) => {
  const formatLowerCase = <ExportFormat>format.toLowerCase();

  if (formatLowerCase === 'json') {
    return JSON.stringify(ruleGroup, null, 2);
  } else if (formatLowerCase === 'json_without_ids') {
    return JSON.stringify(removeIdsFromRuleGroup(ruleGroup));
  } else if (formatLowerCase === 'sql' || formatLowerCase === 'parameterized') {
    const parameterized = formatLowerCase === 'parameterized';
    const params: string[] = [];

    const valueProc: ValueProcessor =
      valueProcessor ||
      ((field: string, operator: string, value: any) => {
        let val = `"${value}"`;
        if (operator.toLowerCase() === 'null' || operator.toLowerCase() === 'notnull') {
          val = '';
        } else if (operator.toLowerCase() === 'in' || operator.toLowerCase() === 'notin') {
          val = `(${value
            .split(',')
            .map((v: string) => `"${v.trim()}"`)
            .join(', ')})`;
        } else if (
          operator.toLowerCase() === 'contains' ||
          operator.toLowerCase() === 'doesnotcontain'
        ) {
          val = `"%${value}%"`;
        } else if (
          operator.toLowerCase() === 'beginswith' ||
          operator.toLowerCase() === 'doesnotbeginwith'
        ) {
          val = `"${value}%"`;
        } else if (
          operator.toLowerCase() === 'endswith' ||
          operator.toLowerCase() === 'doesnotendwith'
        ) {
          val = `"%${value}"`;
        } else if (typeof value === 'boolean') {
          val = `${value}`.toUpperCase();
        }
        return val;
      });

    const processRule = (rule: RuleType) => {
      const value = valueProc(rule.field, rule.operator, rule.value);
      const operator = mapOperator(rule.operator);

      if (parameterized && value) {
        if (operator.toLowerCase() === 'in' || operator.toLowerCase() === 'not in') {
          const splitValue = (<string>rule.value).split(',').map((v) => v.trim());
          splitValue.forEach((v) => params.push(v));
          return `${rule.field} ${operator} (${splitValue.map(() => '?').join(', ')})`;
        }
        const found = (<string>value).match(/^"?(.*?)"?$/);
        if(found && found.length>1){
          params.push(found[1]);
        }        
      }
      return `${rule.field} ${operator} ${parameterized && value ? '?' : value}`.trim();
    };

    const processRuleGroup = (rg: RuleGroupType): string => {
      const processedRules = rg.rules.map((rule) => {
        if (isRuleGroup(rule)) {
          return processRuleGroup(rule);
        }
        return processRule(rule);
      });
      return `${rg.not ? 'NOT ' : ''}(${processedRules.join(` ${rg.combinator} `)})`;
    };

    if (parameterized) {
      return { sql: processRuleGroup(ruleGroup), params };
    } else {
      return processRuleGroup(ruleGroup);
    }
  } else {
    return '';
  }
};

export default formatQuery;
