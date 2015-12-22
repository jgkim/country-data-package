import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import dirtyChai from 'dirty-chai';
import nock from 'nock';
import _ from 'lodash';
import Scraper from '../scripts/Scraper';

chai.use(chaiAsPromised);
chai.use(dirtyChai);

Feature('Country Data Scraping',
  'As a data consumer',
  'I want to scrape data about countries from the Web',
  'so that I can re-use the data for other purposes', () => {
    let scraper;
    let promise;

    Scenario('Good Network Connection', () => {
      before(() => {
        scraper = new Scraper();
        if (!nock.isActive()) nock.activate();
      });

      Given('the network connection is okay', () => {
        nock('https://en.wikipedia.org')
          .get('/wiki/ISO_3166-1')
          .replyWithFile(200, `${__dirname}/fixtures/ISO_3166-1.html`)
          .get('/wiki/Belgium')
          .replyWithFile(200, `${__dirname}/fixtures/BE.html`)
          .get('/wiki/Korea_(Republic_of)')
          .replyWithFile(200, `${__dirname}/fixtures/KR.html`)
          .get('/wiki/United_States_of_America')
          .replyWithFile(200, `${__dirname}/fixtures/US.html`);

        nock('http://wikidata.dbpedia.org')
          .get('/sparql')
          .query({
            query: 'CONSTRUCT{<http://wikidata.dbpedia.org/resource/Q31><http://www.w3.org/2002/07/owl#sameAs>?o}{GRAPH<http://wikidata.dbpedia.org>{<http://wikidata.dbpedia.org/resource/Q31><http://www.w3.org/2002/07/owl#sameAs>?o}}',
          })
          .replyWithFile(200, `${__dirname}/fixtures/Q31.ntriples`, {
            'Content-Type': 'text/plain',
          })
          .get('/sparql')
          .query({
            query: 'CONSTRUCT{<http://wikidata.dbpedia.org/resource/Q884><http://www.w3.org/2002/07/owl#sameAs>?o}{GRAPH<http://wikidata.dbpedia.org>{<http://wikidata.dbpedia.org/resource/Q884><http://www.w3.org/2002/07/owl#sameAs>?o}}',
          })
          .replyWithFile(200, `${__dirname}/fixtures/Q884.ntriples`, {
            'Content-Type': 'text/plain',
          })
          .get('/sparql')
          .query({
            query: 'CONSTRUCT{<http://wikidata.dbpedia.org/resource/Q30><http://www.w3.org/2002/07/owl#sameAs>?o}{GRAPH<http://wikidata.dbpedia.org>{<http://wikidata.dbpedia.org/resource/Q30><http://www.w3.org/2002/07/owl#sameAs>?o}}',
          })
          .replyWithFile(200, `${__dirname}/fixtures/Q30.ntriples`, {
            'Content-Type': 'text/plain',
          });

        nock('http://sws.geonames.org')
          .get('/2802361/about.rdf')
          .replyWithFile(200, `${__dirname}/fixtures/2802361.rdf`, {
            'Content-Type': 'application/rdf+xml',
          })
          .get('/1835841/about.rdf')
          .replyWithFile(200, `${__dirname}/fixtures/1835841.rdf`, {
            'Content-Type': 'application/rdf+xml',
          })
          .get('/6252001/about.rdf')
          .replyWithFile(200, `${__dirname}/fixtures/6252001.rdf`, {
            'Content-Type': 'application/rdf+xml',
          });
      });

      When('the data consumer starts scraping', () => {
        promise = scraper.getCountries();
      });

      Then('data about countries will eventually be returned', () => {
        return promise.then((countries) => {
          expect(countries).to.have.length.of.at.least(3);

          const kr = _.find(countries, { isoTwoLetterCountryCode: 'KR' });
          // expect(kr.englishShortName).to.equal('Korea (Republic of)');
          expect(kr.isoThreeLetterCountryCode).to.equal('KOR');
          expect(kr.isoThreeDigitCountryCode).to.equal('410');
          expect(kr.isoCountrySubdivisionCode).to.equal('ISO 3166-2:KR');
          expect(kr.wikipediaSlug).to.equal('South_Korea');
          expect(kr.wikidataId).to.equal('Q884');
          expect(kr.geoNamesId).to.equal('1835841');
          expect(kr.shortNameEn).to.equal('South Korea');
          expect(kr.officialNameEn).to.equal('Republic of Korea');
          expect(kr.officialNameKo).to.equal('대한민국');
          expect(kr.lat).to.equal(36.5);
          expect(kr.long).to.equal(127.75);
        });
      });

      after(() => {
        nock.cleanAll();
        nock.restore();
      });
    });

    Scenario('Bad Network Connection', () => {
      const previousNockOff = process.env.NOCK_OFF;

      before(() => {
        scraper = new Scraper();

        process.env.NOCK_OFF = false;
        if (!nock.isActive()) nock.activate();
      });

      Given('the network connection is refused', () => {
        nock('https://en.wikipedia.org')
          .get('/wiki/ISO_3166-1')
          .replyWithError('Connection refused');
      });

      When('the data consumer starts scraping', () => {
        promise = scraper.getCountries();
      });

      Then('an error will eventually be returned', () => {
        return expect(promise).to.be.rejectedWith(Error, 'Connection refused');
      });

      after(() => {
        nock.cleanAll();
        nock.restore();
        process.env.NOCK_OFF = previousNockOff;
      });
    });
  });
