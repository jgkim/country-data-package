import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import dirtyChai from 'dirty-chai';
import nock from 'nock';
import fs from 'fs';
import rimraf from 'rimraf';
import _ from 'lodash';
import Scraper from '../scripts/src/Scraper';

chai.use(chaiAsPromised);
chai.use(dirtyChai);

Feature('Country Data Scraping',
  'As a data consumer',
  'I want to scrape data about countries from the Web',
  'so that I can re-use the data for other purposes', () => {
    let scraper;
    let promise;

    Scenario('Connected Networks', () => {
      before(() => {
        scraper = new Scraper();
        if (!nock.isActive()) nock.activate();
      });

      Given('the network connection is okay', () => {
        nock('https://en.wikipedia.org')
          .get('/wiki/ISO_3166-1')
          .replyWithFile(200, `${__dirname}/fixtures/ISO_3166-1.html`)
          .get('/wiki/ISO_3166-2:BE')
          .replyWithFile(200, `${__dirname}/fixtures/ISO_3166-2_BE.html`)
          .get('/wiki/ISO_3166-2:KR')
          .replyWithFile(200, `${__dirname}/fixtures/ISO_3166-2_KR.html`)
          .get('/wiki/ISO_3166-2:US')
          .replyWithFile(200, `${__dirname}/fixtures/ISO_3166-2_US.html`)
          .get('/wiki/ISO_3166-2:LI')
          .replyWithFile(200, `${__dirname}/fixtures/ISO_3166-2_LI.html`)
          .get('/wiki/ISO_3166-2:MC')
          .replyWithFile(200, `${__dirname}/fixtures/ISO_3166-2_MC.html`);

        nock('http://unstats.un.org')
          .get('/unsd/methods/m49/m49regin.htm')
          .replyWithFile(200, `${__dirname}/fixtures/UNSD.html`);

        let defaultQuery = 'action=query&prop=info&inprop=url&redirects=true&format=json';
        nock('https://en.wikipedia.org')
          .defaultReplyHeaders({
            'Content-Type': 'application/json',
          })
          .get(`/w/api.php?${defaultQuery}&titles=Belgium`)
          .replyWithFile(200, `${__dirname}/fixtures/BE.json`)
          .get(`/w/api.php?${defaultQuery}&titles=Korea_(Republic_of)`)
          .replyWithFile(200, `${__dirname}/fixtures/KR.json`)
          .get(`/w/api.php?${defaultQuery}&titles=United_States_of_America`)
          .replyWithFile(200, `${__dirname}/fixtures/US.json`)
          .get(`/w/api.php?${defaultQuery}&titles=Liechtenstein`)
          .replyWithFile(200, `${__dirname}/fixtures/LI.json`)
          .get(`/w/api.php?${defaultQuery}&titles=Monaco`)
          .replyWithFile(200, `${__dirname}/fixtures/MC.json`)
          .get(`/w/api.php?${defaultQuery}&titles=Europe`)
          .replyWithFile(200, `${__dirname}/fixtures/Europe.json`)
          .get(`/w/api.php?${defaultQuery}&titles=Asia`)
          .replyWithFile(200, `${__dirname}/fixtures/Asia.json`)
          .get(`/w/api.php?${defaultQuery}&titles=Americas`)
          .replyWithFile(200, `${__dirname}/fixtures/Americas.json`)
          .get(`/w/api.php?${defaultQuery}&titles=Western_Europe`)
          .replyWithFile(200, `${__dirname}/fixtures/Western_Europe.json`)
          .get(`/w/api.php?${defaultQuery}&titles=Eastern_Asia`)
          .replyWithFile(200, `${__dirname}/fixtures/Eastern_Asia.json`)
          .get(`/w/api.php?${defaultQuery}&titles=Northern_America`)
          .replyWithFile(200, `${__dirname}/fixtures/Northern_America.json`)
          .get(`/w/api.php?${defaultQuery}&titles=Flemish_Region`)
          .replyWithFile(200, `${__dirname}/fixtures/BE-VLG.json`)
          .get(`/w/api.php?${defaultQuery}&titles=Antwerp_(province)`)
          .replyWithFile(200, `${__dirname}/fixtures/BE-VAN.json`)
          .get(`/w/api.php?${defaultQuery}&titles=Seoul`)
          .replyWithFile(200, `${__dirname}/fixtures/KR-11.json`)
          .get(`/w/api.php?${defaultQuery}&titles=California`)
          .replyWithFile(200, `${__dirname}/fixtures/US-CA.json`)
          .get(`/w/api.php?${defaultQuery}&titles=Balzers`)
          .replyWithFile(200, `${__dirname}/fixtures/LI-01.json`)
          .get(`/w/api.php?${defaultQuery}&titles=Sainte-D%C3%A9vote_Chapel`)
          .replyWithFile(200, `${__dirname}/fixtures/MC-SD.json`);

        defaultQuery = 'action=wbgetentities&sites=enwiki&props=labels%7Cclaims&format=json';
        nock('https://www.wikidata.org')
          .defaultReplyHeaders({
            'Content-Type': 'application/json',
          })
          .get(`/w/api.php?${defaultQuery}&titles=United_States`)
          .replyWithFile(200, `${__dirname}/fixtures/Q30.json`)
          .get(`/w/api.php?${defaultQuery}&titles=South_Korea`)
          .replyWithFile(200, `${__dirname}/fixtures/Q884.json`)
          .get(`/w/api.php?${defaultQuery}&titles=Belgium`)
          .replyWithFile(200, `${__dirname}/fixtures/Q31.json`)
          .get(`/w/api.php?${defaultQuery}&titles=Liechtenstein`)
          .replyWithFile(200, `${__dirname}/fixtures/Q347.json`)
          .get(`/w/api.php?${defaultQuery}&titles=Monaco`)
          .replyWithFile(200, `${__dirname}/fixtures/Q235.json`)
          .get(`/w/api.php?${defaultQuery}&titles=Europe`)
          .replyWithFile(200, `${__dirname}/fixtures/Q46.json`)
          .get(`/w/api.php?${defaultQuery}&titles=Asia`)
          .replyWithFile(200, `${__dirname}/fixtures/Q48.json`)
          .get(`/w/api.php?${defaultQuery}&titles=Americas`)
          .replyWithFile(200, `${__dirname}/fixtures/Q828.json`)
          .get(`/w/api.php?${defaultQuery}&titles=Northern_America`)
          .replyWithFile(200, `${__dirname}/fixtures/Q2017699.json`)
          .get(`/w/api.php?${defaultQuery}&titles=East_Asia`)
          .replyWithFile(200, `${__dirname}/fixtures/Q27231.json`)
          .get(`/w/api.php?${defaultQuery}&titles=Western_Europe`)
          .replyWithFile(200, `${__dirname}/fixtures/Q27496.json`)
          .get(`/w/api.php?${defaultQuery}&titles=Flemish_Region`)
          .replyWithFile(200, `${__dirname}/fixtures/Q9337.json`)
          .get(`/w/api.php?${defaultQuery}&titles=Antwerp_(province)`)
          .replyWithFile(200, `${__dirname}/fixtures/Q1116.json`)
          .get(`/w/api.php?${defaultQuery}&titles=Seoul`)
          .replyWithFile(200, `${__dirname}/fixtures/Q8684.json`)
          .get(`/w/api.php?${defaultQuery}&titles=California`)
          .replyWithFile(200, `${__dirname}/fixtures/Q99.json`)
          .get(`/w/api.php?${defaultQuery}&titles=Balzers`)
          .replyWithFile(200, `${__dirname}/fixtures/Q49663.json`)
          .get(`/w/api.php?${defaultQuery}&titles=Sainte-D%C3%A9vote_Chapel`)
          .replyWithFile(200, `${__dirname}/fixtures/Q584191.json`);

        nock('http://sws.geonames.org')
          .defaultReplyHeaders({
            'Content-Type': 'application/rdf+xml',
          })
          .get('/2802361/about.rdf')
          .replyWithFile(200, `${__dirname}/fixtures/2802361.rdf`)
          .get('/1835841/about.rdf')
          .replyWithFile(200, `${__dirname}/fixtures/1835841.rdf`)
          .get('/6252001/about.rdf')
          .replyWithFile(200, `${__dirname}/fixtures/6252001.rdf`)
          .get('/3042058/about.rdf')
          .replyWithFile(200, `${__dirname}/fixtures/3042058.rdf`)
          .get('/2993457/about.rdf')
          .replyWithFile(200, `${__dirname}/fixtures/2993457.rdf`)
          .get('/6255148/about.rdf')
          .replyWithFile(200, `${__dirname}/fixtures/6255148.rdf`)
          .get('/6255147/about.rdf')
          .replyWithFile(200, `${__dirname}/fixtures/6255147.rdf`)
          .get('/10861432/about.rdf')
          .replyWithFile(200, `${__dirname}/fixtures/10861432.rdf`)
          .get('/7729890/about.rdf')
          .replyWithFile(200, `${__dirname}/fixtures/7729890.rdf`)
          .get('/7729894/about.rdf')
          .replyWithFile(200, `${__dirname}/fixtures/7729894.rdf`)
          .get('/9408659/about.rdf')
          .replyWithFile(200, `${__dirname}/fixtures/9408659.rdf`)
          .get('/3337388/about.rdf')
          .replyWithFile(200, `${__dirname}/fixtures/3337388.rdf`)
          .get('/2803136/about.rdf')
          .replyWithFile(200, `${__dirname}/fixtures/2803136.rdf`)
          .get('/1835847/about.rdf')
          .replyWithFile(200, `${__dirname}/fixtures/1835847.rdf`)
          .get('/3042073/about.rdf')
          .replyWithFile(200, `${__dirname}/fixtures/3042073.rdf`)
          .get('/5332921/about.rdf')
          .replyWithFile(200, `${__dirname}/fixtures/5332921.rdf`);
      });

      When('the data consumer starts scraping', () => {
        promise = scraper.getData();
      });

      Then('data about countries will eventually be returned', () => {
        return promise.then((data) => {
          expect(data.continents).to.have.length.of.at.least(3);
          expect(data.regions).to.have.length.of.at.least(3);
          expect(data.countries).to.have.length.of.at.least(5);
          expect(data.subdivisions).to.have.length.of.at.least(11);

          const asia = _.find(data.continents, { unM49Code: '142' });
          expect(asia.wikipediaSlug).to.equal('Asia');
          expect(asia.wikidataId).to.equal('Q48');
          expect(asia.geoNamesId).to.equal('6255147');
          expect(asia.name).to.equal('Asia');
          expect(asia.en.officialName).to.equal('Asia');
          expect(asia.ko.officialName).to.equal('아시아');
          expect(asia.en.wikipediaLabel).to.equal('Asia');
          expect(asia.ko.wikipediaLabel).to.equal('아시아');
          expect(asia.latitude).to.equal(29.84064);
          expect(asia.longitude).to.equal(89.29688);

          const easternAsia = _.find(asia.regions, { unM49Code: '030' });
          expect(easternAsia.continent).to.equal(asia);
          expect(easternAsia.wikipediaSlug).to.equal('East_Asia');
          expect(easternAsia.wikidataId).to.equal('Q27231');
          expect(easternAsia.geoNamesId).to.equal('7729894');
          expect(easternAsia.name).to.equal('Eastern Asia');
          expect(easternAsia.en.wikipediaLabel).to.equal('East Asia');
          expect(easternAsia.ko.wikipediaLabel).to.equal('동아시아');
          expect(easternAsia.latitude).to.equal(32.24997);
          expect(easternAsia.longitude).to.equal(114.60938);

          const kr = _.find(easternAsia.countries, { isoTwoLetterCountryCode: 'KR' });
          expect(kr.region).to.equal(easternAsia);
          expect(kr.isoThreeLetterCountryCode).to.equal('KOR');
          expect(kr.isoThreeDigitCountryCode).to.equal('410');
          expect(kr.wikipediaSlug).to.equal('South_Korea');
          expect(kr.wikidataId).to.equal('Q884');
          expect(kr.geoNamesId).to.equal('1835841');
          expect(kr.name).to.equal('South Korea');
          expect(kr.en.officialName).to.equal('Republic of Korea');
          expect(kr.ko.officialName).to.equal('대한민국');
          expect(kr.ko.alternateName).to.include('한국');
          expect(kr.en.shortName).to.equal('South Korea');
          expect(kr.en.wikipediaLabel).to.equal('South Korea');
          expect(kr.ko.wikipediaLabel).to.equal('대한민국');
          expect(kr.latitude).to.equal(36.5);
          expect(kr.longitude).to.equal(127.75);

          const seoul = _.find(kr.subdivisions, { isoCountrySubdivisionCode: 'KR-11' });
          expect(seoul.country).to.equal(kr);
          expect(seoul.isoSubdivisionCode).to.equal('11');
          expect(seoul.wikipediaSlug).to.equal('Seoul');
          expect(seoul.wikidataId).to.equal('Q8684');
          expect(seoul.geoNamesId).to.equal('1835847');
          expect(seoul.name).to.equal('Seoul');
          expect(seoul.en.officialName).to.equal('Seoul');
          expect(seoul.ko.officialName).to.equal('서울특별시');
          expect(seoul.ko.alternateName).to.contain('서울');
          expect(seoul.en.wikipediaLabel).to.equal('Seoul');
          expect(seoul.ko.wikipediaLabel).to.equal('서울특별시');
          expect(seoul.latitude).to.equal(37.58333);
          expect(seoul.longitude).to.equal(127);

          const flanders = _.find(data.subdivisions, { isoCountrySubdivisionCode: 'BE-VLG' });
          const antwerp = _.find(flanders.subSubdivions, { isoCountrySubdivisionCode: 'BE-VAN' });
          expect(antwerp.parentSubdivision).to.equal(flanders);
        });
      });

      And('the returned data will be stored in JSON files', () => {
        return scraper.saveData().then(() => {
          const continents = JSON.parse(fs.readFileSync(`${__dirname}/fixtures/continents.json`));
          expect(JSON.parse(fs.readFileSync(`${__dirname}/data/continents.json`))).to.deep.equal(continents);
          const regions = JSON.parse(fs.readFileSync(`${__dirname}/fixtures/regions.json`));
          expect(JSON.parse(fs.readFileSync(`${__dirname}/data/regions.json`))).to.deep.equal(regions);
          const countries = JSON.parse(fs.readFileSync(`${__dirname}/data/countries.json`));
          expect(JSON.parse(fs.readFileSync(`${__dirname}/data/countries.json`))).to.deep.equal(countries);
          const subdivisions = JSON.parse(fs.readFileSync(`${__dirname}/fixtures/subdivisions.json`));
          expect(JSON.parse(fs.readFileSync(`${__dirname}/data/subdivisions.json`))).to.deep.equal(subdivisions);
          rimraf.sync(`${__dirname}/data`);
        });
      });

      after(() => {
        nock.cleanAll();
        nock.restore();
      });
    });

    Scenario('Disconnected Networks', () => {
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
        promise = scraper.getData();
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
