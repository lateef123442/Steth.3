/**
 * Universities in Nigeria (federal, state and private), sorted A–Z for the signup dropdown.
 * New universities are licensed every year, so the list ends with "Other" for anything missing.
 */
const FEDERAL = [
  "Abubakar Tafawa Balewa University, Bauchi", "Admiralty University of Nigeria, Ibusa",
  "Ahmadu Bello University, Zaria", "Alex Ekwueme Federal University, Ndufu-Alike",
  "Bayero University, Kano", "Federal University, Dutse", "Federal University, Dutsin-Ma",
  "Federal University, Gashua", "Federal University, Gusau", "Federal University, Kashere",
  "Federal University, Lafia", "Federal University, Lokoja", "Federal University, Otuoke",
  "Federal University, Oye-Ekiti", "Federal University, Wukari", "Federal University of Agriculture, Abeokuta",
  "Federal University of Agriculture and Development Studies, Iragbiji", "Federal University of Agriculture, Makurdi",
  "Federal University of Health Sciences, Azare", "Federal University of Health Sciences, Ila-Orangun",
  "Federal University of Health Sciences, Otukpo", "Federal University of Petroleum Resources, Effurun",
  "Federal University of Technology, Akure", "Federal University of Technology, Babura",
  "Federal University of Technology, Ikot Abasi", "Federal University of Technology, Minna",
  "Federal University of Technology, Owerri", "Federal University of Transportation, Daura",
  "Federal University of Education, Kano", "Federal University of Education, Zaria",
  "Michael Okpara University of Agriculture, Umudike", "Modibbo Adama University, Yola",
  "National Open University of Nigeria", "Nigeria Police Academy, Wudil", "Nigerian Army University, Biu",
  "Nigerian Defence Academy, Kaduna", "Nigerian Maritime University, Okerenkoko",
  "Nnamdi Azikiwe University, Awka", "Obafemi Awolowo University, Ile-Ife", "University of Abuja",
  "University of Agriculture and Environmental Sciences, Umuagwo", "University of Benin",
  "University of Calabar", "University of Ibadan", "University of Ilorin", "University of Jos",
  "University of Lagos", "University of Maiduguri", "University of Nigeria, Nsukka",
  "University of Port Harcourt", "University of Uyo", "Usmanu Danfodiyo University, Sokoto",
  "Air Force Institute of Technology, Kaduna", "Federal University of Environment and Technology, Ogoni",
  "Federal University of Applied Sciences, Kachia", "Federal University of Agriculture and Development Studies, Iragbiji",
];

const STATE = [
  "Abia State University, Uturu", "Adamawa State University, Mubi", "Adekunle Ajasin University, Akungba-Akoko",
  "Akwa Ibom State University, Ikot Akpaden", "Ambrose Alli University, Ekpoma", "Bauchi State University, Gadau",
  "Benue State University, Makurdi", "Borno State University, Maiduguri", "Chukwuemeka Odumegwu Ojukwu University, Uli",
  "Delta State University, Abraka", "Delta State University of Science and Technology, Ozoro",
  "Ebonyi State University, Abakaliki", "Edo State University, Uzairue", "Ekiti State University, Ado-Ekiti",
  "Enugu State University of Science and Technology", "Gombe State University", "Ignatius Ajuru University of Education, Port Harcourt",
  "Imo State University, Owerri", "Ibrahim Badamasi Babangida University, Lapai", "Kaduna State University",
  "Kano University of Science and Technology, Wudil", "Kebbi State University of Science and Technology, Aliero",
  "Kogi State University, Anyigba", "Kwara State University, Malete", "Ladoke Akintola University of Technology, Ogbomoso",
  "Lagos State University, Ojo", "Lagos State University of Education, Oto-Ijanikin",
  "Lagos State University of Science and Technology, Ikorodu", "Moshood Abiola University of Science and Technology, Abeokuta",
  "Nasarawa State University, Keffi", "Niger Delta University, Wilberforce Island", "Olabisi Onabanjo University, Ago-Iwoye",
  "Olusegun Agagu University of Science and Technology, Okitipupa", "Osun State University, Osogbo",
  "Plateau State University, Bokkos", "Rivers State University, Port Harcourt", "Sokoto State University",
  "Tai Solarin University of Education, Ijagun", "Taraba State University, Jalingo", "University of Africa, Toru-Orua",
  "University of Agriculture and Environmental Sciences, Umuagwo", "Yobe State University, Damaturu",
  "Yusuf Maitama Sule University, Kano", "Umaru Musa Yar'adua University, Katsina", "Sule Lamido University, Kafin Hausa",
  "Zamfara State University", "Aliko Dangote University of Science and Technology, Wudil", "Bayelsa Medical University, Yenagoa",
  "Prince Abubakar Audu University, Anyigba", "Ondo State University of Medical Sciences, Ondo",
  "Federal University of Technology, Ikot Abasi", "Gombe State University of Science and Technology, Kumo",
  "Abdulkadir Kure University, Minna", "Kogi State University of Education, Ankpa",
];

const PRIVATE = [
  "Achievers University, Owo", "Adeleke University, Ede", "Afe Babalola University, Ado-Ekiti", "African University of Science and Technology, Abuja",
  "Ajayi Crowther University, Oyo", "Al-Hikmah University, Ilorin", "Al-Istiqama University, Sumaila", "Al-Qalam University, Katsina",
  "American University of Nigeria, Yola", "Amadeus University, Amizi", "Anchor University, Lagos", "Arthur Jarvis University, Akpabuyo",
  "Atiba University, Oyo", "Augustine University, Ilara-Epe", "Baze University, Abuja", "Bells University of Technology, Ota",
  "Benson Idahosa University, Benin City", "Bingham University, Karu", "Bowen University, Iwo", "Caleb University, Imota",
  "Caritas University, Enugu", "Chrisland University, Abeokuta", "Christopher University, Mowe", "Clifford University, Owerrinta",
  "Coal City University, Enugu", "Covenant University, Ota", "Crawford University, Igbesa", "Crescent University, Abeokuta",
  "Dominion University, Ibadan", "Edwin Clark University, Kiagbodo", "Elizade University, Ilara-Mokin", "Evangel University, Akaeze",
  "Fountain University, Osogbo", "Godfrey Okoye University, Enugu", "Gregory University, Uturu", "Hallmark University, Ijebu-Itele",
  "Hezekiah University, Umudi", "Veritas University, Abuja", "Igbinedion University, Okada", "Joseph Ayo Babalola University, Ikeji-Arakeji",
  "Kings University, Odeomu", "Kola Daisi University, Ibadan", "Landmark University, Omu-Aran", "Lead City University, Ibadan",
  "Lens University, Ilemona", "Lifeline University, Kwara", "Madonna University, Okija", "Mcpherson University, Ajebo",
  "Mountain Top University, Prayer City", "Nile University of Nigeria, Abuja", "Novena University, Ogume", "Obong University, Obong Ntak",
  "Oduduwa University, Ipetumodu", "Pan-Atlantic University, Lagos", "Paul University, Awka", "Precious Cornerstone University, Ibadan",
  "Redeemer's University, Ede", "Renaissance University, Enugu", "Rhema University, Aba", "Ritman University, Ikot Ekpene",
  "Salem University, Lokoja", "Samuel Adegboyega University, Ogwa", "Southwestern University, Okun-Owa", "Summit University, Offa",
  "Tansian University, Umunya", "Thomas Adewumi University, Oko-Irese", "Trinity University, Yaba", "University of Mkar, Mkar",
  "Wellspring University, Benin City", "Wesley University, Ondo", "Western Delta University, Oghara", "Westland University, Iwo",
  "Yadala University, Kogi", "Sam Maris University, Supare Akoko", "Skyline University, Kano", "Spiritan University, Nneochi",
  "Mudiame University, Irrua", "Nok University, Kachia", "North-West University, Sokoto", "Peaceland University, Enugu",
  "PAMO University of Medical Sciences, Port Harcourt", "Philomath University, Abuja", "Sapientia University, Abuja",
  "Maranatha University, Lagos", "Margaret Lawrence University, Umunya", "Eko University of Medicine and Health Sciences, Ijanikin",
  "Elizade University, Ilara-Mokin", "Greenfield University, Kasarami", "Legacy University, Okija", "Karl-Kumm University, Vom",
  "Capital City University, Kano", "Aletheia University, Ago-Iwoye", "Baba Ahmed University, Kano", "Ave Maria University, Piyanko",
  "Bluecrest University, Abuja", "Eastern Palm University, Ogboko", "Venite University, Iloro-Ekiti", "Michael and Cecilia Ibru University, Agbarha-Otor",
];

const OTHER = "Other (not listed)";

const unique = Array.from(new Set([...FEDERAL, ...STATE, ...PRIVATE]));
export const NIGERIAN_UNIVERSITIES: string[] = [...unique.sort((a, b) => a.localeCompare(b)), OTHER];
