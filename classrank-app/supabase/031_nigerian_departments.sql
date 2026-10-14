-- Common Nigerian university departments for the signup dropdown. Safe to run more than once.
with d(name, faculty) as (values
  ('Accounting','Management Sciences'),('Banking and Finance','Management Sciences'),('Business Administration','Management Sciences'),
  ('Marketing','Management Sciences'),('Public Administration','Management Sciences'),
  ('Agricultural Economics','Agriculture'),('Agronomy','Agriculture'),('Animal Science','Agriculture'),('Crop Science','Agriculture'),('Soil Science','Agriculture'),
  ('Architecture','Environmental Sciences'),('Building Technology','Environmental Sciences'),('Estate Management','Environmental Sciences'),
  ('Quantity Surveying','Environmental Sciences'),('Surveying and Geoinformatics','Environmental Sciences'),('Urban and Regional Planning','Environmental Sciences'),
  ('Biochemistry','Science'),('Biology','Science'),('Botany','Science'),('Chemistry','Science'),('Computer Science','Science'),
  ('Cyber Security','Science'),('Geology','Science'),('Industrial Chemistry','Science'),('Mathematics','Science'),('Microbiology','Science'),
  ('Physics','Science'),('Statistics','Science'),('Zoology','Science'),('Information Technology','Science'),('Software Engineering','Science'),
  ('Chemical Engineering','Engineering'),('Civil Engineering','Engineering'),('Computer Engineering','Engineering'),
  ('Electrical/Electronic Engineering','Engineering'),('Mechanical Engineering','Engineering'),('Petroleum Engineering','Engineering'),
  ('Mechatronics Engineering','Engineering'),('Agricultural Engineering','Engineering'),('Metallurgical and Materials Engineering','Engineering'),
  ('Anatomy','Basic Medical Sciences'),('Physiology','Basic Medical Sciences'),('Medical Biochemistry','Basic Medical Sciences'),
  ('Medicine and Surgery','Clinical Sciences'),('Nursing Science','Health Sciences'),('Pharmacy','Pharmaceutical Sciences'),
  ('Medical Laboratory Science','Health Sciences'),('Radiography','Health Sciences'),('Physiotherapy','Health Sciences'),
  ('Dentistry','Dental Sciences'),('Public Health','Health Sciences'),('Veterinary Medicine','Veterinary Medicine'),
  ('Law','Law'),('Mass Communication','Social Sciences'),('Economics','Social Sciences'),('Political Science','Social Sciences'),
  ('Sociology','Social Sciences'),('Psychology','Social Sciences'),('Geography','Social Sciences'),('International Relations','Social Sciences'),
  ('English Language','Arts'),('History and International Studies','Arts'),('Linguistics','Arts'),('Philosophy','Arts'),
  ('Religious Studies','Arts'),('Theatre Arts','Arts'),('Fine and Applied Arts','Arts'),('Music','Arts'),
  ('Education (Arts)','Education'),('Education (Science)','Education'),('Guidance and Counselling','Education'),
  ('Library and Information Science','Education'),('Early Childhood Education','Education')
)
insert into departments (name, faculty)
select d.name, d.faculty from d
where not exists (select 1 from departments x where lower(x.name) = lower(d.name));
