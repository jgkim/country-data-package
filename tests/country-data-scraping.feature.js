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
          .matchHeader('Accept', /text\/(n3|turtle)/)
          .get('/resource/Q31')
          .replyWithFile(200, `${__dirname}/fixtures/Q31.n3`, {
              'Content-Type': 'text/n3',
            })
          .matchHeader('Accept', /application\/n\-triples/)
          .get('/resource/Q884')
          .replyWithFile(200, `${__dirname}/fixtures/Q884.ntriples`, {
              'Content-Type': 'application/n-triples; qs=0.95',
            })
          .matchHeader('Accept', /application\/rdf\+xml/)
          .get('/resource/Q30')
          .replyWithFile(200, `${__dirname}/fixtures/Q30.rdf`, {
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
          expect(kr.englishShortName).to.equal('Korea (Republic of)');
          expect(kr.isoThreeLetterCountryCode).to.equal('KOR');
          expect(kr.isoThreeDigitCountryCode).to.equal('410');
          expect(kr.isoCountrySubdivisionCode).to.equal('ISO 3166-2:KR');
          expect(kr.wikipediaSlug).to.equal('South_Korea');
          expect(kr.wikidataId).to.equal('Q884');

          // For parsing N-Triples with quality tag for content negotiation
          expect(kr.geoNamesId).to.equal('1835841');

          // For parsing N3
          const be = _.find(countries, { isoTwoLetterCountryCode: 'BE' });
          expect(be.geoNamesId).to.equal('2802361');

          // For parsing RDF/XML
          const us = _.find(countries, { isoTwoLetterCountryCode: 'US' });
          expect(us.geoNamesId).to.equal('6252001');
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
