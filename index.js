require('dotenv').config();
const debug = require('debug')('jolokia-metrics-exporter');
const express = require('express');
const app = express();
const fs = require('fs');
const YAML = require('yaml');
const got = require('got').extend({
  username: process.env.USERNAME,
  password: process.env.PASSWORD,
  prefixUrl: process.env.JOLOKIA_URL,
  https: {
			rejectUnauthorized: false
	}
});


const configFileContent = fs.readFileSync(process.env.CONFIG_YML || '/usr/src/app/config.yaml', 'utf8');
const config = YAML.parse(configFileContent);

debug('launch request');

class Rule {
  constructor({rawString, mbeanClass, mbeanPath, filter, labels, attribute, overrideValue, valueFactor, help, type, name, attrNameSnakeCase}) {
    this.rawString = rawString;
    this.mbeanClass = mbeanClass;
    this.mbeanPath = mbeanPath;
    this.attribute = attribute;
    this.help = help;
    this.type = type;
    this.name = name;
    this.attrNameSnakeCase = attrNameSnakeCase;
    this.labels = labels || {};
    this.filter = filter || {};
    this.overrideValue = overrideValue;
    this.valueFactor = valueFactor;

    if (this.attribute.indexOf('/') !== -1) {
      this.path = this.attribute.split('/').slice(0, -1).join('/');
      this.attribute = this.attribute.split('/').slice(-1).join('/');
    } else {
      this.path = undefined;
    }
    if (this.attribute.indexOf('(') !== -1) {
      this.attributeRegExp = new RegExp(this.attribute);
    } else {
      this.attributeRegExp = null;
    }
  }

  toJolokiaRequest() {
    return {
      "type": "read",
      "mbean": this.mbeanClass + ":" + this.mbeanPath,
      "attribute": this.path
    }
  }

  getPrometheusLinesForJolokiaResponse(jolokiaResponse) {
    let matchedValues = [];
    let replaceValues = [];

    let resultValues = [];
    if (Array.isArray(jolokiaResponse.value)) {
      resultValues = jolokiaResponse.value;
    } else {
      resultValues = [jolokiaResponse.value];
    }

    resultValues.forEach((resultValue) => {
      if (this.filter) {
        let isMatch = true;
        Object.keys(this.filter).forEach((filterKey) => {
          if (this.filter[filterKey] !== resultValue[filterKey]) {
            isMatch = false;
          }
        })

        if (!isMatch) {
          return false;
        }
      }
      if (this.attributeRegExp) {
        Object.keys(resultValue).forEach((key) => {
          let attributeMatch = this.attributeRegExp.exec(key);
          debug('attributeMatch', attributeMatch, key, this.attributeRegExp);
          if (attributeMatch) {
            if (attributeMatch[0] === attributeMatch[1]) {
              /* full match: (TheKey) */
              let replacer = {};
              replacer['$1'] = attributeMatch[1];
              matchedValues.push({value: resultValue[key], replacer});
            } else {
              /* partial match: The(Part)OfTheKey */
            }
          }
        });
      } else {
        if (typeof resultValue[this.attribute] !== undefined) {
          matchedValues.push({value: resultValue[this.attribute]});
        }
      }
    });
    let replacePositionalParameters = (match, replacer) => {
      return replacer[match] || 'undefined';
    };
    let snakeCase = (string) => {
       string = string.charAt(0).toLowerCase() + string.slice(1);
       return string.split(/(?=[A-Z])/).join('_').replace(/(\-)/g, '_').toLowerCase();
    }

    debug('matchedValues', matchedValues);
    let isNameAlreadyDefinedMap = {};

    let lines = [];
    matchedValues.forEach((matchedValue) => {
      matchedValue.replacer = matchedValue.replacer || {};
      matchedValue.replacer['$0'] = matchedValue.value;
          let name = this.name.replace(/(\$\d+)/, (match) => replacePositionalParameters(match, matchedValue.replacer));
          if (this.attrNameSnakeCase) {
             name = snakeCase(name);
          }
          if (!isNameAlreadyDefinedMap[name]) {
            if (this.help) {
              let help = this.help.replace(/(\$\d+)/, (match) => replacePositionalParameters(match, matchedValue.replacer));
              lines.push('# HELP ' + name + ' ' + help);
            }
            lines.push('# TYPE ' + name + ' ' + this.type.toLowerCase());
            isNameAlreadyDefinedMap[name] = true;
          }
          let labelsSuffixParts = [];
          Object.keys(this.labels).forEach((sourceLabelKey) => {
            let labelKey = sourceLabelKey.replace(/(\$\d+)/, (match) => replacePositionalParameters(match, matchedValue.replacer));
            let labelValue = this.labels[sourceLabelKey].replace(/(\$\d+)/, (match) => replacePositionalParameters(match, matchedValue.replacer));
            labelsSuffixParts.push([labelKey, '=', '"', labelValue, '"'].join(''));
          });
          let overrideValue = this.overrideValue;
          if (typeof overrideValue === "undefined") {
            overrideValue = matchedValue.value;
          }
          if (typeof this.valueFactor !== "undefined") {
            overrideValue = this.valueFactor * overrideValue;
          }
          if (labelsSuffixParts.length > 0) {
            lines.push(name + '{' + labelsSuffixParts.join(",") + '} ' + overrideValue);
          } else {
            lines.push(name + ' ' + overrideValue);
          }
    });
    return lines;
  }
}

const convertRuleConfigToRule = (ruleConfig) =>  {
  let ruleOptions = {};
  let patternMatch = /^([^<]+)<([^>]+)><>(.+)$/.exec(ruleConfig.pattern);
  debug(patternMatch);
  if (!patternMatch) {
    throw new Error('Invalid pattern');
  }
  [rawString, mbeanClass, mbeanPath, attribute] = patternMatch;

  return new Rule({rawString, mbeanClass, mbeanPath, attribute, overrideValue: ruleConfig.value, valueFactor: ruleConfig.valueFactor, filter: ruleConfig.filter, labels: ruleConfig.labels, help: ruleConfig.help, name: ruleConfig.name, type: ruleConfig.type,
attrNameSnakeCase: ruleConfig.attrNameSnakeCase || false});
}

let enableRequest = true;


let rules = config.rules.map(convertRuleConfigToRule);
rules.forEach((rule) => {
  debug('rule', rule);
});

const getMetrics = () => {
  return got.post('', {
    json: rules.map((rule) => rule.toJolokiaRequest())
  }).json().then((jolokiaResponse) => {
    return new Promise((resolve, reject) => {
    let lines = [];
    debug('jolokiaRequest', rules.map((rule) => rule.toJolokiaRequest()));
    debug('jolokiaResponse', jolokiaResponse);
    rules.forEach((rule, pos) => {
       debug('response', rule, jolokiaResponse[pos]);

       if (jolokiaResponse[pos].stacktrace) {
         debug('error response', jolokiaResponse[pos].stacktrace);
         return;
       }

       rule.getPrometheusLinesForJolokiaResponse(jolokiaResponse[pos]).forEach((line) => {
         debug('line', line);
         lines.push(line);
       });
    });
      resolve(lines);
    });
  });
};

if (enableRequest) {
  getMetrics().then((lines) => {
  });
}

setTimeout(() => {}, 60 * 1000 * 1000);


app.get('/', function (req, res) {
  res.set('X-App-Version', process.env.APP_VERSION || 'dev')
  res.send('OK');
});

app.get('/metrics', function (req, res) {
  res.set('X-App-Version', process.env.APP_VERSION || 'dev')
  getMetrics().then((lines) => {
    res.send(lines.join("\n"));
  });
});

app.listen(process.env.PORT || 9442, '0.0.0.0', function () {
});


