CREATE INDEX customer_phone_normalized ON customer(replace(replace(phone,' ',''),'-',''));
