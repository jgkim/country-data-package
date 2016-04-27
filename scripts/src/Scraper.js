#!/usr/bin/env node

import 'babel-polyfill';
import _ from 'lodash';
import xray from 'x-ray';

import rdf from 'rdf-ext';
import RdfXmlParser from 'rdf-parser-rdfxml';
rdf.parsers = new rdf.Parsers({
  'application/rdf+xml': RdfXmlParser,
});

import request from 'superagent';
import cheerio from 'cheerio';

import DefaultCategoryMappings from './DefaultCategoryMappings';
import WikidataGeoNamesMappings from './WikidataGeoNamesMappings';
import Iso31662WikipediaMappings from './Iso31662WikipediaMappings';

import stringify from 'streaming-json-stringify';
import fs from 'fs';
import path from 'path';

import debug from 'debug';
import Progress from 'progress';

class Scraper {
  constructor(data = {}) {
    this.throttleTime = 250;
    this.progressBar = null;
    this.data = data;
  }

  /**
  * _getCountryList() scrapes codes and links of countries in ISO 3166-1 from Wikipedia.
  *
  * @access private
  * @return {Promise}
  */
  _getCountryList() {
    return new Promise((resolve, reject) => {
      const scraper = xray();

      scraper('https://en.wikipedia.org/wiki/ISO_3166-1',
        'h3:has(#Officially_assigned_code_elements) ~ table.wikitable:first-of-type > tr',
        [{
          isoTwoLetterCountryCode: 'td:nth-child(2)',
          isoThreeLetterCountryCode: 'td:nth-child(3)',
          isoThreeDigitCountryCode: 'td:nth-child(4)',
          _wikipediaUri: 'td:nth-child(1) a@href',
        }])((error, data) => {
          if (error) {
            reject(error);
          } else {
            resolve(data);
          }
        });
    });
  }

  /**
  * _getWikiIds() scrapes the Wikipedia canonical slug of each entity.
  *
  * @access private
  * @param {Array} entities
  * @return {Promise} a promise that waits for all promises for entities to be fulfilled
  */
  _getWikiIds(entities) {
    const promises = [];

    entities.map((entity, index) => {
      promises.push(new Promise((resolve, reject) => {
        if (entity && entity._wikipediaUri) {
          setTimeout(() => {
            const entityReference = entity;
            let slug = _.trimRight(entityReference._wikipediaUri, '/');
            delete entityReference._wikipediaUri;
            slug = slug.substring(slug.lastIndexOf('/') + 1);

            request
              .get('https://en.wikipedia.org/w/api.php')
              .query({
                action: 'query',
                prop: 'info',
                inprop: 'url',
                redirects: true,
                format: 'json',
                titles: decodeURIComponent(slug),
              })
              .end((error, response) => {
                if (error) {
                  reject(error);
                } else {
                  // Get the first page of the results.
                  _.forEach(response.body.query.pages, (page, id) => {
                    if (id !== '-1') {
                      const canonicalSlug = _.trimRight(page.canonicalurl, '/');
                      entityReference.wikipediaSlug = canonicalSlug.substring(canonicalSlug.lastIndexOf('/') + 1);
                    }

                    return false;
                  });

                  if (process.env.NODE_ENV !== 'test') {
                    this.progressBar.tick();
                  }

                  resolve(entityReference);
                }
              });
          }, this.throttleTime * index);
        } else {
          if (process.env.NODE_ENV !== 'test') {
            this.progressBar.tick();
          }

          resolve(entity);
        }
      }));
    });

    return Promise.all(promises);
  }

  /**
  * _setValueWithLanguage() sets the property value with the language of the key on the object.
  *
  * @access public
  * @param {Object} the object to augment
  * @param {string} the language of the property value
  * @param {string} the key of the property to set
  * @param {string} the value to set
  * @return {Object} the reference of the augmented object
  */
  _setValueWithLanguage(object, language, key, value) {
    const objectReference = object;

    if (language) {
      objectReference[language] = objectReference[language] || {};

      if (!objectReference[language][key]) {
        objectReference[language][key] = value;
      } else {
        if (_.isString(objectReference[language][key])) {
          objectReference[language][key] = objectReference[language][key].split();
        }
        objectReference[language][key].push(value);
      }
    }

    return objectReference;
  }

  /**
  * _getGeoNamesIds() scrapes the GeoNames ID of each entity.
  *
  * @access private
  * @param {Array} entities
  * @return {Promise} a promise that waits for all promises for entities to be fulfilled
  */
  _getGeoNamesIds(entities) {
    const promises = [];

    entities.map((entity, index) => {
      promises.push(new Promise((resolve, reject) => {
        if (entity.wikipediaSlug) {
          setTimeout(() => {
            request
              .get('https://www.wikidata.org/w/api.php')
              .query({
                action: 'wbgetentities',
                sites: 'enwiki',
                props: 'labels|claims',
                format: 'json',
                titles: decodeURIComponent(entity.wikipediaSlug),
              })
              .end((error, response) => {
                if (error) {
                  reject(error);
                } else {
                  const entityReference = entity;

                  // Get the first entity of the results.
                  _.forEach(response.body.entities, (wikidata, id) => {
                    if (id !== '-1') {
                      entityReference.wikidataId = id;

                      if (entityReference.wikidataId in WikidataGeoNamesMappings) {
                        if (WikidataGeoNamesMappings[entityReference.wikidataId]) {
                          entityReference.geoNamesId = WikidataGeoNamesMappings[entityReference.wikidataId];
                        }
                      } else {
                        try {
                          entityReference.geoNamesId = wikidata.claims.P1566[0].mainsnak.datavalue.value;
                        } catch (exception) {
                          reject(`Cannot find a GeoNames ID for this Wikidata entity: ${entityReference.wikidataId}`);
                        }
                      }

                      _.forEach(wikidata.labels, (label) => {
                        this._setValueWithLanguage(entityReference, label.language, 'wikipediaLabel', label.value);
                      });
                    }

                    return false;
                  });

                  if (process.env.NODE_ENV !== 'test') {
                    this.progressBar.tick();
                  }

                  resolve(entityReference);
                }
              });
          }, this.throttleTime * index);
        } else {
          if (process.env.NODE_ENV !== 'test') {
            this.progressBar.tick();
          }

          resolve(entity);
        }
      }));
    });

    return Promise.all(promises);
  }

  /**
  * _getGeoNamesData() scrapes the data of each entity from GeoNames.
  *
  * @access private
  * @param {Array} entities
  * @return {Promise} a promise that waits for all promises for entities to be fulfilled
  */
  _getGeoNamesData(entities) {
    const promises = [];

    entities.map((entity, index) => {
      promises.push(new Promise((resolve, reject) => {
        if (entity.geoNamesId) {
          setTimeout(() => {
            rdf.defaultRequest('get', `http://sws.geonames.org/${entity.geoNamesId}/about.rdf`).then((response) => {
              return rdf.parsers.parse('application/rdf+xml', response.content);
            }).then((graph) => {
              const entityReference = entity;

              graph.forEach((triple) => {
                const gn = (name) => { return `http://www.geonames.org/ontology#${name}`; };
                const wgs84 = (name) => { return `http://www.w3.org/2003/01/geo/wgs84_pos#${name}`; };

                if (triple.predicate.equals(gn('name'))) {
                  entityReference.name = triple.object.toString();
                } else if (triple.predicate.equals(wgs84('lat'))) {
                  entityReference.latitude = parseFloat(triple.object.toString());
                } else if (triple.predicate.equals(wgs84('long'))) {
                  entityReference.longitude = parseFloat(triple.object.toString());
                }

                ['officialName', 'alternateName', 'shortName'].forEach((name) => {
                  if (triple.predicate.equals(gn(name))) {
                    this._setValueWithLanguage(entityReference, triple.object.language, name, triple.object.toString());
                  }
                });
              });

              if (process.env.NODE_ENV !== 'test') {
                this.progressBar.tick();
              }

              resolve(entityReference);
            }).catch((exception) => {
              reject(exception);
            });
          }, this.throttleTime * index + (3600000 * Math.floor(index / 1700)));
        } else {
          if (process.env.NODE_ENV !== 'test') {
            this.progressBar.tick();
          }

          resolve(entity);
        }
      }));
    });

    return Promise.all(promises);
  }

  /**
  * _getRegionList() scrapes codes and links of continental and sub-continental regions from UNSD.
  *
  * @access public
  * @param {Array} countries
  * @return {Promise}
  */
  _getRegionList(countries) {
    return new Promise((resolve, reject) => {
      request
        .get('http://unstats.un.org/unsd/methods/m49/m49regin.htm')
        .end((error, response) => {
          if (error) {
            reject(error);
          } else {
            // Fix the borken HTML of the UNSD page.
            const text = response.text.replace(/(Saint\-Barth[\s\S]+?<\/tr>)/m, '$1<tr>');
            const html = cheerio.load(text);
            const table = html('td.content[width="100%"]>table:nth-of-type(4)');

            const continents = [];
            const regions = [];

            table.find('tr').each((index, element) => {
              const tr = cheerio(element);

              // Break the loop if it's not the first header.
              if (tr.find('td.cheader2').length) {
                return (index) ? false : true;
              }

              const tds = tr.find('td');
              const code = _.trim(tds.eq(0).text());
              // Skip the row if it's empty.
              if (!code) return true;

              // Find a continental region.
              let continent = tds.eq(1).find('h3 b');
              if (continent.length) {
                const span = continent.find('span.content');
                if (span.length) {
                  continent = span;
                }
                continent = _.trim(continent.text());

                const newContinent = {
                  unM49Code: code,
                  // Rough mapping of names to Wikipedia URIs
                  _wikipediaUri: `https://en.wikipedia.org/wiki/${continent.replace(/\s/g, '_')}`,
                  regions: [],
                };
                continents.push(newContinent);

                return true;
              }

              // Find a sub-continental region.
              let region = tds.eq(1).find('b');
              if (region.length) {
                region = _.trim(region.text());

                // Exception handling for Latin America and the Caribbean
                if (code === '419') {
                  region = 'Community of Latin American and Caribbean States';
                }

                const newRegion = {
                  unM49Code: code,
                  // Rough mapping of names to Wikipedia URIs
                  _wikipediaUri: `https://en.wikipedia.org/wiki/${region.replace(/\s/g, '_')}`,
                  continent: _.last(continents),
                  countries: [],
                };
                newRegion.continent.regions.push(newRegion);
                regions.push(newRegion);

                return true;
              }

              /*
               * ISO 3166-1 numeric codes are similar to the three-digit country codes
               * developed and maintained by the United Nations Statistics Division,
               * from which they originate in its UN M.49 standard.
               */
              const country = _.find(countries, { isoThreeDigitCountryCode: code });
              if (country) {
                country.region = _.last(regions);
                country.region.countries.push(country);
              }
            });

            resolve([continents, regions, countries, _.flatten(_.pluck(countries, 'subdivisions'))]);
          }
        });
    });
  }

  /**
  * _getSubdivisionList() scrapes codes and links of subdivisions of each country in ISO 3166-2 from Wikipedia.
  *
  * @access private
  * @param {Array} countries
  * @return {Promise}
  */
  _getSubdivisionList(countries) {
    const promises = [];

    countries.map((country, index) => {
      const countryReference = country;

      promises.push(new Promise((resolve, reject) => {
        setTimeout(() => {
          request
            .get(`https://en.wikipedia.org/wiki/ISO_3166-2:${country.isoTwoLetterCountryCode.toUpperCase()}`)
            .end((error, response) => {
              if (error) {
                reject(error);
              } else {
                const html = cheerio.load(response.text);
                const siblings = html('h2:has(#Current_codes)').nextAll();

                const subdivisions = [];

                // For countries without category headings
                let defaultCategory = DefaultCategoryMappings[countryReference.isoTwoLetterCountryCode.toUpperCase()];
                let tableIndex = 0;

                siblings.each((siblingIndex, sibling) => {
                  const element = cheerio(sibling);

                  // Break the loop if the element is <h2>.
                  if (element.is('h2')) {
                    return false;
                  }

                  // Get a default category from the heading.
                  if (!defaultCategory && element.is('h3')) {
                    const heading = element.find('.mw-headline').text();

                    switch (heading) {
                      case 'Chains (of islands)':
                        defaultCategory = 'Chain';
                        break;
                      case 'Municipalities':
                        defaultCategory = 'Municipality';
                        break;
                      case 'Parishes':
                        defaultCategory = 'Parish';
                        break;
                      case 'Counties':
                      // Exception handling for Kenya
                      case '47 counties':
                        defaultCategory = 'County';
                        break;
                      case 'Autonomous republic':
                        defaultCategory = 'Autonomous republic';
                        break;
                      default:
                        if (_.endsWith(heading, 's')) {
                          defaultCategory = heading.slice(0, -1);
                        }
                    }

                  // Get data from a table.
                  } else if (element.is('table')) {
                    let codeIndex;
                    let categoryIndex;
                    let subdivisionIndex;

                    element.find('th').each((headerIndex, th) => {
                      const header = cheerio(th).text();

                      if (header.match(/Code/i)) {
                        codeIndex = headerIndex + 1;
                      } else if (header.match(/category/i)) {
                        categoryIndex = headerIndex + 1;
                      } else if (header.match(/^(in|parent)/mi)) {
                        subdivisionIndex = headerIndex + 1;
                      }

                      return true;
                    });

                    element.find('tr').each((rowIndex, tr) => {
                      const row = cheerio(tr);

                      const code = _.trim(row.find(`td:nth-child(${codeIndex})`).text()).toUpperCase();

                      if (code.length && !_.find(subdivisions, 'isoCountrySubdivisionCode', code)) {
                        const newSubdivision = {};
                        newSubdivision.country = countryReference;
                        newSubdivision.isoCountrySubdivisionCode = code;
                        newSubdivision.isoSubdivisionCode = newSubdivision.isoCountrySubdivisionCode.split('-').pop();

                        let wikipediaUri = row.find(`td a`).attr('href');
                        if (_.startsWith(wikipediaUri, '/wiki/File:') || _.endsWith(wikipediaUri, '_language')) {
                          wikipediaUri = row.find(`td a`).next().attr('href');
                        }

                        if (code in Iso31662WikipediaMappings) {
                          if (Iso31662WikipediaMappings[code]) {
                            newSubdivision._wikipediaUri = Iso31662WikipediaMappings[code];
                          }
                        } else if (wikipediaUri && !wikipediaUri.match(/action=edit/i)) {
                          newSubdivision._wikipediaUri = `https://en.wikipedia.org${wikipediaUri}`;
                        }

                        if (!newSubdivision._wikipediaUri) {
                          newSubdivision.name = _.trim(row.find(`td:nth-child(${codeIndex + 1})`).text());
                        }

                        newSubdivision.isoSubdivisionCategory = (categoryIndex) ? _.capitalize(_.trim(row.find(`td:nth-child(${categoryIndex})`).text())) : defaultCategory;

                        if (tableIndex > 0 && subdivisionIndex) {
                          let parentSubdivision = row.find(`td:nth-child(${subdivisionIndex}) a`) || row.find(`td:nth-child(${subdivisionIndex})`);
                          parentSubdivision = _.trim(parentSubdivision.first().text());
                          if (parentSubdivision && !parentSubdivision.match(/(&#x2014;|—)/)) {
                            if (parentSubdivision.match(/\-/)) {
                              parentSubdivision = parentSubdivision.split('-').pop();
                            }
                            newSubdivision.parentSubdivision = _.find(subdivisions, 'isoSubdivisionCode', parentSubdivision);

                            newSubdivision.parentSubdivision.subSubdivions = newSubdivision.parentSubdivision.subSubdivions || [];
                            newSubdivision.parentSubdivision.subSubdivions.push(newSubdivision);
                          }
                        }

                        subdivisions.push(newSubdivision);
                      }
                    });

                    tableIndex++;
                  }
                });
                countryReference.subdivisions = subdivisions;

                if (process.env.NODE_ENV !== 'test') {
                  this.progressBar.tick();
                }

                resolve(countryReference);
              }
            });
        }, this.throttleTime * index);
      }));
    });

    return Promise.all(promises);
  }

  /**
   * _saveData() saves data into a file under the data directory.
   *
   * @access private
   * @param {String} directory name
   * @param {String} filename
   * @param {Array} data
   * @param {Object} options
   */
  _saveData(directoryName, filename, data, options) {
    return new Promise((resolve, reject) => {
      fs.mkdir(directoryName, (error) => {
        if (error && (error.code !== 'EEXIST')) {
          reject(error);
        } else {
          const stringifyReplacer = stringify({
            replacer: (key, value) => {
              if (_.has(options, key)) {
                if (options[key]) {
                  return value[options[key]];
                }

                return undefined;
              }

              return value;
            },
          });

          stringifyReplacer.pipe(fs.createWriteStream(path.join(directoryName, filename)));
          data.forEach((item) => {
            stringifyReplacer.write(item);
          });
          stringifyReplacer.end();
          stringifyReplacer.on('end', resolve);
          stringifyReplacer.on('error', reject);
        }
      });
    });
  }

  /**
  * logData() logs data via debug('scraper:log').
  *
  * @access public
  */
  logData() {
    const log = debug('scraper:log');

    this.data.continents.forEach((continent) => {
      log(continent.name);
      continent.regions.forEach((region) => {
        log(`=> ${region.name}`);
        region.countries.forEach((country) => {
          log(`  => ${country.name}`);

          country.subdivisions.forEach((subdivision) => {
            let subdivisionName = subdivision.name;
            if (!subdivisionName && subdivision.en) {
              subdivisionName = subdivision.en.wikipediaLabel;
            }
            if (subdivision.parentSubdivision) {
              let parentName = subdivision.parentSubdivision.name;
              if (!parentName && subdivision.parentSubdivision.en) {
                parentName = subdivision.parentSubdivision.en.wikipediaLabel;
              }
              log(`    => ${parentName} / ${subdivisionName}`);
            } else {
              log(`    => ${subdivisionName}`);
            }
          });
        });
      });
    });
  }

  /**
  * getData() scrapes data about countries, and their continents, regions, and principal subdivisions.
  *
  * @access public
  * @return {Promise}
  */
  getData() {
    if (_.isEmpty(this.data)) {
      return this._getCountryList()
        .then((countries) => {
          if (process.env.NODE_ENV !== 'test') {
            this.progressBar = new Progress('Subdivisions:  [:bar] :percent :etas', { total: countries.length });
          }

          return this._getSubdivisionList(countries);
        })
        .then((countries) => {
          return this._getRegionList(countries);
        })
        .then((data) => {
          if (process.env.NODE_ENV !== 'test') {
            const length = data.reduce((previous, current) => {
              return previous + current.length;
            }, 0);
            this.progressBar = new Progress('Wiki IDs:      [:bar] :percent :etas', { total: length });
          }

          return Promise.all([
            this._getWikiIds(data[0]),
            this._getWikiIds(data[1]),
            this._getWikiIds(data[2]),
            this._getWikiIds(data[3]),
          ]);
        })
        .then((data) => {
          if (process.env.NODE_ENV !== 'test') {
            const length = data.reduce((previous, current) => {
              return previous + current.length;
            }, 0);
            this.progressBar = new Progress('GeoNames IDs:  [:bar] :percent :etas', { total: length });
          }

          return Promise.all([
            this._getGeoNamesIds(data[0]),
            this._getGeoNamesIds(data[1]),
            this._getGeoNamesIds(data[2]),
            this._getGeoNamesIds(data[3]),
          ]);
        })
        .then((data) => {
          if (process.env.NODE_ENV !== 'test') {
            const length = data.reduce((previous, current) => {
              return previous + current.length;
            }, 0);
            this.progressBar = new Progress('GeoNames Data: [:bar] :percent :etas', { total: length });
          }

          return Promise.all([
            this._getGeoNamesData(data[0]),
            this._getGeoNamesData(data[1]),
            this._getGeoNamesData(data[2]),
            this._getGeoNamesData(data[3]),
          ]);
        })
        .then((data) => {
          this.data.continents = data[0];
          this.data.regions = data[1];
          this.data.countries = data[2];
          this.data.subdivisions = data[3];

          this.logData();

          return this.data;
        });
    }

    return Promise.resolve(this.data);
  }

  /**
  * saveData() saves scraped data about countries, and their continents, regions, and principal subdivisions into respective files.
  *
  * @access public
  * @param {String} directory name
  * @return {Promise}
  */
  saveData(directoryName) {
    return this.getData().then(() => {
      return Promise.all([
        this._saveData(directoryName, 'continents.json', this.data.continents, {
          'regions': undefined,
        }),
        this._saveData(directoryName, 'regions.json', this.data.regions, {
          'continent': 'unM49Code',
          'countries': undefined,
        }),
        this._saveData(directoryName, 'countries.json', this.data.countries, {
          'region': 'unM49Code',
          'subdivisions': undefined,
        }),
        this._saveData(directoryName, 'subdivisions.json', this.data.subdivisions, {
          'country': 'isoTwoLetterCountryCode',
          'parentSubdivision': 'isoCountrySubdivisionCode',
        }),
      ]);
    });
  }
}

if (!module.parent) {
  process.on('unhandledRejection', (error) => {
    debug('scraper:error')(error);
  });

  const scraper = new Scraper();
  scraper.saveData('./data');
}

export default Scraper;
